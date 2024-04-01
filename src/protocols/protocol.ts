export type FrameStream<ReceiveFrame, SendFrame> = {
  send: (frame: SendFrame) => void,
  onProcess: (callback: (frame: ReceiveFrame) => void) => void,
};

export type DataStream<ReceiveData, SendData> = {
  onSend: (callback: (data: SendData) => void) => void,
  process: (data: ReceiveData) => void,
};

export type HandlerContext<
  ReceiveFrame extends object,
  ReceiveData extends object,
  SendFrame extends object,
  SendData extends object,
> = {
  onProcessFrame: (callback: (frame: ReceiveFrame) => { consumed: boolean }) => void,
  processData: (data: ReceiveData) => void,
  sendFrame: (frame: SendFrame) => void,
  onSendData: (callback: (data: SendData) => void) => void,
};

export type ProtocolOptions<SubProtocols extends Record<string, Protocol<any, any, any, any, any>>> = {
  protocols: SubProtocols,
};

export type SubProtocolFor<P extends AnyProtocol> =
  | Protocol<P[TypeInformation]["ReceiveData"], any, P[TypeInformation]["SendData"], any, {}, {}>
  | Protocol<P[TypeInformation]["ReceiveData"], never, P[TypeInformation]["SendData"], never, {}, {}>;
export type AnyProtocol = SubProtocolFor<any>;

export type ProtocolHandler<P extends AnyProtocol> = ProtocolHandlerInner<
  P[TypeInformation]["ReceiveFrame"],
  P[TypeInformation]["ReceiveData"],
  P[TypeInformation]["SendFrame"],
  P[TypeInformation]["SendData"],
  P[TypeInformation]["SubProtocols"]
>;

type ProtocolHandlerInner<
  ReceiveFrame extends object,
  ReceiveData extends object,
  SendFrame extends object,
  SendData extends object,
  SubProtocols extends Record<string, AnyProtocol>
> = {
  protocols: {
    [K in keyof SubProtocols]: ReturnType<SubProtocols[K]["createHandler"]>;
  },
  onReceiveFrame: (callback: (frame: ReceiveFrame) => void) => (() => void),
  onReceiveData: (callback: (data: ReceiveData) => void) => (() => void),
  onSendFrame: (callback: (frame: SendFrame) => void) => (() => void),
  onSendData: (callback: (data: SendData) => void) => (() => void),
  destroy: () => void,
};

export const typeInformation = "__hiddenTypeInformationDoesNotExistAtRuntime";
export type TypeInformation = typeof typeInformation;

export abstract class Protocol<
  ReceiveFrame extends object,
  ReceiveData extends object,
  SendFrame extends object,
  SendData extends object,
  SubProtocols extends Record<string, Protocol<ReceiveData, any, SendData, any, any>>,
  AdditionalOptions extends object = {},
> {
  // @ts-expect-error hack to get the generic type information
  [typeInformation]: {
    ReceiveFrame: ReceiveFrame,
    ReceiveData: ReceiveData,
    SendFrame: SendFrame,
    SendData: SendData,
    SubProtocols: SubProtocols,
    AdditionalOptions: AdditionalOptions,
  };

  public readonly options;
  constructor(options: Partial<ProtocolOptions<SubProtocols>> & AdditionalOptions) {
    this.options = {
      protocols: {},
      ...options,
    };
  }

  public abstract get displayName(): string;

  public abstract createHandler(base: ProtocolHandler<this>, context: HandlerContext<ReceiveFrame, ReceiveData, SendFrame, SendData>): ProtocolHandler<this>;
}
