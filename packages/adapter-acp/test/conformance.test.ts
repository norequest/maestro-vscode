import type { AdapterFactory } from "@hallucinate/conformance";
import { runConformanceSuite } from "@hallucinate/conformance";
import { AcpAdapter } from "../src/adapter.js";
import {
  FakeAcpTransport,
  acpSessionUpdate,
  acpTurnComplete,
} from "./fake-transport.js";
import type { AcpTransportFn } from "../src/types.js";

const factory: AdapterFactory = () => {
  const transport = new FakeAcpTransport();
  const fn: AcpTransportFn = () => transport;
  const adapter = new AcpAdapter({ transportFn: fn, command: "gemini" });

  return {
    adapter,
    completeSuccessfully: () => {
      transport.receive(acpTurnComplete("done"));
      transport.end();
    },
    failWithError: () => {
      transport.endWithError("ACP crashed");
    },
    emitOutput: (text: string) => {
      transport.receive(acpSessionUpdate(text));
    },
  };
};

runConformanceSuite("AcpAdapter", factory);
