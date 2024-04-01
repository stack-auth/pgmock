type Callback<
  CallbackData,
  CallbackResult,
  CallbackMetadata,
> = (
  data: CallbackData,
  target: CallbackEventTarget<CallbackData, CallbackResult, CallbackMetadata>,
  metadata: CallbackMetadata
) => CallbackResult;

type Listener<CallbackData, CallbackResult, CallbackMetadata> = {
  remove: () => void,
  once: boolean,
  callback: Callback<CallbackData, CallbackResult, CallbackMetadata>,
  metadata: CallbackMetadata,
};


export class CallbackEventTarget<
  CallbackData = void,
  CallbackResult = void,
  CallbackMetadata = void,
> {
  private _callbacks: Map<Callback<CallbackData, CallbackResult, CallbackMetadata>, Listener<CallbackData, CallbackResult, CallbackMetadata>> = new Map();

  private _addListener(callback: Callback<CallbackData, CallbackResult, CallbackMetadata>, metadata: CallbackMetadata, once: boolean) {
    if (this._callbacks.has(callback)) {
      throw new Error("Callback already added!");
    }
    const listener = {
      callback,
      once,
      metadata,
      remove: () => this.removeListener(callback)
    };
    this._callbacks.set(callback, listener);
    return listener;
  }

  public addListener(callback: Callback<CallbackData, CallbackResult, CallbackMetadata>, metadata: CallbackMetadata) {
    return this._addListener(callback, metadata, false);
  }

  public addListenerOnce(callback: Callback<CallbackData, CallbackResult, CallbackMetadata>, metadata: CallbackMetadata) {
    return this._addListener(callback, metadata, true);
  }

  public removeListener(callback: Callback<CallbackData, CallbackResult, CallbackMetadata>) {
    if (!this._callbacks.has(callback)) {
      throw new Error("Cannot remove listener from target that does not exist!");
    }
    this._callbacks.delete(callback);
  }

  public removeAllListeners() {
    this._callbacks.clear();
  }

  public hasListener(callback?: Callback<CallbackData, CallbackResult, CallbackMetadata>) {
    return callback ? this._callbacks.has(callback) : this._callbacks.size > 0;
  }

  public listeners() {
    return this._callbacks.entries();
  }

  public get listenersCount() {
    return this._callbacks.size;
  }

  public emit(data: CallbackData): {
    callback: Callback<CallbackData, CallbackResult, CallbackMetadata>,
    result: CallbackResult,
    metadata: CallbackMetadata,
  }[] {
    const result = [];
    for (const [callback, { once, metadata }] of this._callbacks.entries()) {
      if (once) {
        this._callbacks.delete(callback);
      }
      result.push({
        callback: callback,
        result: callback(data, this, metadata),
        metadata,
      });
    }
    return result;
  }
}
