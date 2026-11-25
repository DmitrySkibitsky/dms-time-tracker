import { clockifyDescriptor } from "../../src/providers/clockify/provider.ts";
import { createClockifyFake, FAKE_API_KEY } from "../fakes/clockifyFake.ts";
import { runProviderContract } from "./providerContract.ts";

runProviderContract(clockifyDescriptor, () => {
    const fake = createClockifyFake();
    const make = (apiKey: string) => clockifyDescriptor.create({ settings: { apiKey }, transport: fake.transport });
    return {
        provider: make(FAKE_API_KEY),
        unauthorized: make("wrong-key"),
        workspaceId: "ws-1",
        projectId: "p-web",
        seed: entry => fake.seed(entry).id,
        goOffline: () => {
            fake.state.offline = true;
        }
    };
});
