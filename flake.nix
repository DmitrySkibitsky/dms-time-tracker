{
  description = "Time Tracker: a time tracking plugin for DMS (Dux Modular Shell), Clockify first";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # QML sources of the shell the plugin runs in; qmllint/qmlls resolve `qs.*` imports
    # against them. Sources only (flake = false): nothing of DMS is built.
    dms = {
      url = "github:AvengeMedia/DankMaterialShell";
      flake = false;
    };
    # DMS's `DCommon` (a git submodule in the DMS repo).
    dux-qml-common = {
      url = "github:duxlabs-dev/dux-qml-common";
      flake = false;
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      dms,
      dux-qml-common,
    }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system} system);

      # Files shipped to users: the plugin directory as DMS loads it.
      pluginFiles =
        lib:
        lib.fileset.toSource {
          root = ./.;
          fileset = lib.fileset.unions [
            ./plugin.json
            ./TimeTrackerDaemon.qml
            ./TimeTrackerWidget.qml
            ./TimeTrackerSettings.qml
            ./ui
            ./lib
            ./translations
            ./README.md
            ./LICENSE
          ];
        };

      # The DMS shell tree as Quickshell loads it (quickshell/ + DCommon from its submodule).
      dmsShellSources =
        pkgs:
        pkgs.runCommand "dms-shell-qml-sources" { } ''
          cp -r ${dms}/quickshell $out
          chmod -R u+w $out
          rm -rf $out/DCommon
          cp -r ${dux-qml-common}/DCommon $out/DCommon
        '';

      toolEnv = pkgs: {
        DMS_SHELL_DIR = "${dmsShellSources pkgs}";
        QUICKSHELL_QML_DIR = "${pkgs.quickshell}/lib/qt-6/qml";
        # qmltestrunner needs the offscreen platform plugin.
        QT_PLUGIN_PATH = "${pkgs.qt6.qtbase}/${pkgs.qt6.qtbase.qtPluginPrefix}";
        QMLTESTRUNNER = "${pkgs.qt6.qtdeclarative}/bin/qmltestrunner";
      };
    in
    {
      packages = forAllSystems (
        pkgs: _: {
          default = pkgs.stdenvNoCC.mkDerivation {
            pname = "dms-time-tracker";
            version = (builtins.fromJSON (builtins.readFile ./plugin.json)).version;
            src = pluginFiles pkgs.lib;
            installPhase = ''
              runHook preInstall
              cp -r . $out
              runHook postInstall
            '';
            meta = {
              description = "Time tracking plugin for DMS (Dux Modular Shell)";
              homepage = "https://github.com/DmitrySkibitsky/dms-time-tracker";
              license = pkgs.lib.licenses.mit;
              platforms = pkgs.lib.platforms.linux;
            };
          };
        }
      );

      devShells = forAllSystems (
        pkgs: _: {
          default = pkgs.mkShell (
            {
              packages = [
                pkgs.nodejs_24
                pkgs.qt6.qtdeclarative # qmllint, qmlformat, qmltestrunner, qmlls
                pkgs.qt6.qtbase
                pkgs.git
              ];
              shellHook = ''
                if [ ! -d node_modules ]; then
                  echo "dms-time-tracker: run 'npm ci' to install the TypeScript toolchain"
                fi
                git config core.hooksPath .githooks 2>/dev/null || true
                # .qml-env + .qmlls.ini: lets qmllint and editors (qmlls) resolve qs.* and Quickshell.
                node scripts/qml-env.ts >/dev/null 2>&1 || echo "dms-time-tracker: could not prepare the QML environment"
              '';
            }
            // toolEnv pkgs
          );
        }
      );

      # `nix flake check`: everything that needs no npm packages (tsc/biome run via npm in CI).
      checks = forAllSystems (
        pkgs: system: {
          plugin = self.packages.${system}.default;

          tests = pkgs.stdenvNoCC.mkDerivation (
            {
              name = "dms-time-tracker-checks";
              src = ./.;
              nativeBuildInputs = [
                pkgs.nodejs_24
                pkgs.esbuild
                pkgs.qt6.qtdeclarative
              ];
              dontConfigure = true;
              dontWrapQtApps = true;
              buildPhase = ''
                runHook preBuild
                export HOME=$TMPDIR TZ=UTC

                echo "▸ unit + contract tests"
                node --test "tests/unit/**/*.test.ts" "tests/contract/**/*.test.ts"

                echo "▸ manifest, translations"
                node scripts/check-manifest.ts
                node scripts/i18n.ts check

                echo "▸ qmlformat, qmllint"
                node scripts/format-qml.ts --check
                node scripts/lint-qml.ts

                echo "▸ QML tests (committed lib/tracker.mjs)"
                mkdir -p tests/qml/generated
                esbuild tests/fakes/index.ts --bundle --format=esm --platform=neutral --target=es2016 \
                  --outfile=tests/qml/generated/fakes.mjs --log-level=warning
                sh scripts/run-qml-tests.sh

                runHook postBuild
              '';
              installPhase = "touch $out";
            }
            // toolEnv pkgs
          );
        }
      );

      formatter = forAllSystems (pkgs: _: pkgs.nixfmt);

      # Home Manager: `programs.dms-time-tracker.enable = true;`
      homeModules.default =
        {
          config,
          lib,
          pkgs,
          ...
        }:
        let
          cfg = config.programs.dms-time-tracker;
        in
        {
          options.programs.dms-time-tracker = {
            enable = lib.mkEnableOption "the Time Tracker DMS plugin";
            package = lib.mkOption {
              type = lib.types.package;
              default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
              description = "The plugin package to install.";
            };
          };
          config = lib.mkIf cfg.enable {
            # DMS discovers plugins in $XDG_CONFIG_HOME/dms/plugins/<dir>.
            xdg.configFile."dms/plugins/timeTracker".source = cfg.package;
          };
        };
    };
}
