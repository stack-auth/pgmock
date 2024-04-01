import { Logger } from "../logger.js";
import { HandlerContext, Protocol, ProtocolHandler, ProtocolOptions, SubProtocolFor } from "./protocol.js";

type AdditionalOptions<ReceiveFrame extends object> = {
  consumeIf: (frame: ReceiveFrame) => boolean,
  consoleMessage?: string,
};

export class Noop<ReceiveFrame extends object> extends Protocol<ReceiveFrame, never, never, never, {}, AdditionalOptions<ReceiveFrame>> {
  public readonly displayName = "No-op";

  public constructor(options: Partial<ProtocolOptions<{}>> & AdditionalOptions<ReceiveFrame>) {
    super(options);
  }

  public createHandler(base: ProtocolHandler<this>, context: HandlerContext<ReceiveFrame, never, never, never>): ProtocolHandler<this> {
    context.onProcessFrame((frame) => {
      if (!this.options.consumeIf(frame)) {
        return { consumed: false };
      }

      if (this.options.consoleMessage) {
        Logger.log(this.options.consoleMessage, { frame, noopProtocol: this });
      }
      return { consumed: true };
    });
    return base;
  }
}
