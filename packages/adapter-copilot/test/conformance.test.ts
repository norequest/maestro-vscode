import type { AdapterFactory } from "@maestro/conformance";
import { runConformanceSuite } from "@maestro/conformance";
import { CopilotAdapter } from "../src/adapter.js";
import type { FakeChild } from "./fake-spawn.js";
import { makeFakeSpawn } from "./fake-spawn.js";

const factory: AdapterFactory = () => {
  const fake = makeFakeSpawn();
  const adapter = new CopilotAdapter({ spawn: fake.fn });
  let child: FakeChild | undefined;

  return {
    adapter,
    completeSuccessfully: () => {
      child = fake.child();
      child?.close(0);
    },
    failWithError: () => {
      child = fake.child();
      child?.close(1);
    },
    emitOutput: (text: string) => {
      child = fake.child();
      child?.out(text);
    },
  };
};

runConformanceSuite("CopilotAdapter", factory);
