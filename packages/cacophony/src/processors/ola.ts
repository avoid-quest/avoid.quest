const WEBAUDIO_BLOCK_SIZE = 128;
const DEFAULT_BLOCK_SIZE = 1024; // Default block size if not provided in options

/** Overlap-Add Node */
export default abstract class OLAProcessor extends AudioWorkletProcessor {
  nbInputs: number;
  nbOutputs: number;
  blockSize: number;
  hopSize: number;
  nbOverlaps: number;
  inputBuffers: Float32Array[][] = [];
  inputBuffersHead: Float32Array[][] = [];
  inputBuffersToSend: Float32Array[][] = [];
  outputBuffers: Float32Array[][] = [];
  outputBuffersToRetrieve: Float32Array[][] = [];

  constructor(options: AudioWorkletNodeOptions) {
    super(options);

    this.nbInputs = options.numberOfInputs || 1;
    this.nbOutputs = options.numberOfOutputs || 1;

    this.blockSize = options.processorOptions.blockSize || DEFAULT_BLOCK_SIZE;
    this.hopSize = WEBAUDIO_BLOCK_SIZE;
    this.nbOverlaps = Math.floor(this.blockSize / this.hopSize);

    this.initializeBuffers();
  }

  private initializeBuffers() {
    this.inputBuffers = new Array(this.nbInputs);
    this.inputBuffersHead = new Array(this.nbInputs);
    this.inputBuffersToSend = new Array(this.nbInputs);
    this.outputBuffers = new Array(this.nbOutputs);
    this.outputBuffersToRetrieve = new Array(this.nbOutputs);

    for (let i = 0; i < this.nbInputs; i++) {
      this.allocateInputChannels(i, 1);
    }

    for (let i = 0; i < this.nbOutputs; i++) {
      this.allocateOutputChannels(i, 1);
    }
  }

  private allocateInputChannels(inputIndex: number, nbChannels: number) {
    this.inputBuffers[inputIndex] = new Array(nbChannels);
    this.inputBuffersHead[inputIndex] = new Array(nbChannels);
    this.inputBuffersToSend[inputIndex] = new Array(nbChannels);

    for (let i = 0; i < nbChannels; i++) {
      const buffer = new Float32Array(this.blockSize + WEBAUDIO_BLOCK_SIZE);
      buffer.fill(0);
      this.inputBuffers[inputIndex][i] = buffer;
      const head = this.inputBuffers[inputIndex][i];
      if (head) {
        this.inputBuffersHead[inputIndex][i] = head.subarray(0, this.blockSize);
      }
      this.inputBuffersToSend[inputIndex][i] = new Float32Array(this.blockSize);
    }
  }

  private allocateOutputChannels(outputIndex: number, nbChannels: number) {
    this.outputBuffers[outputIndex] = new Array(nbChannels);
    this.outputBuffersToRetrieve[outputIndex] = new Array(nbChannels);

    for (let i = 0; i < nbChannels; i++) {
      const buffer = new Float32Array(this.blockSize);
      buffer.fill(0);
      this.outputBuffers[outputIndex][i] = buffer;
      this.outputBuffersToRetrieve[outputIndex][i] = new Float32Array(
        this.blockSize
      );
    }
  }

  private reallocateChannelsIfNeeded(
    inputs: Float32Array[][],
    outputs: Float32Array[][]
  ) {
    for (let i = 0; i < this.nbInputs; i++) {
      const input = inputs[i];
      if (input) {
        const nbChannels = input.length;
        const currentBuffers = this.inputBuffers[i];
        if (currentBuffers && nbChannels !== currentBuffers.length) {
          this.allocateInputChannels(i, nbChannels);
        }
      }
    }

    for (let i = 0; i < this.nbOutputs; i++) {
      const output = outputs[i];
      if (output) {
        const nbChannels = output.length;
        const currentBuffers = this.outputBuffers[i];
        if (currentBuffers && nbChannels !== currentBuffers.length) {
          this.allocateOutputChannels(i, nbChannels);
        }
      }
    }
  }

  private readInputs(inputs: Float32Array[][]) {
    for (let i = 0; i < this.nbInputs; i++) {
      const input = inputs[i];
      const buffers = this.inputBuffers[i];
      if (input && buffers) {
        for (let j = 0; j < buffers.length; j++) {
          const webAudioBlock = input[j];
          const buffer = buffers[j];
          if (webAudioBlock && buffer) {
            buffer.set(webAudioBlock, this.blockSize);
          }
        }
      }
    }
  }

  private writeOutputs(outputs: Float32Array[][]) {
    for (let i = 0; i < this.nbOutputs; i++) {
      const output = outputs[i];
      const buffers = this.outputBuffers[i];
      if (output && buffers) {
        for (let j = 0; j < buffers.length; j++) {
          const webAudioBlock = output[j];
          const buffer = buffers[j];
          if (webAudioBlock && buffer) {
            webAudioBlock.set(buffer.subarray(0, WEBAUDIO_BLOCK_SIZE));
          }
        }
      }
    }
  }

  private shiftInputBuffers() {
    for (let i = 0; i < this.nbInputs; i++) {
      const buffers = this.inputBuffers[i];
      if (buffers) {
        for (const buffer of buffers) {
          if (buffer) {
            buffer.copyWithin(0, WEBAUDIO_BLOCK_SIZE);
          }
        }
      }
    }
  }

  private shiftOutputBuffers() {
    for (let i = 0; i < this.nbOutputs; i++) {
      const buffers = this.outputBuffers[i];
      if (buffers) {
        for (const buffer of buffers) {
          if (buffer) {
            buffer.copyWithin(0, WEBAUDIO_BLOCK_SIZE);
            buffer.fill(0, this.blockSize - WEBAUDIO_BLOCK_SIZE);
          }
        }
      }
    }
  }

  private prepareInputBuffersToSend() {
    for (let i = 0; i < this.nbInputs; i++) {
      const buffersToSend = this.inputBuffersToSend[i];
      const buffersHead = this.inputBuffersHead[i];
      if (buffersToSend && buffersHead) {
        for (let j = 0; j < buffersToSend.length; j++) {
          const toSend = buffersToSend[j];
          const head = buffersHead[j];
          if (toSend && head) {
            toSend.set(head);
          }
        }
      }
    }
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Complex buffer management for overlap-add processing
  private handleOutputBuffersToRetrieve() {
    for (let i = 0; i < this.nbOutputs; i++) {
      const buffers = this.outputBuffers[i];
      const buffersToRetrieve = this.outputBuffersToRetrieve[i];
      if (buffers && buffersToRetrieve) {
        for (let j = 0; j < buffers.length; j++) {
          const buffer = buffers[j];
          const toRetrieve = buffersToRetrieve[j];
          if (buffer && toRetrieve) {
            for (let k = 0; k < this.blockSize; k++) {
              const retrieveValue = toRetrieve[k];
              if (retrieveValue !== undefined) {
                buffer[k] = (buffer[k] ?? 0) + retrieveValue / this.nbOverlaps;
              }
            }
          }
        }
      }
    }
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: AudioParamMap
  ): boolean {
    this.reallocateChannelsIfNeeded(inputs, outputs);

    this.readInputs(inputs);
    this.shiftInputBuffers();
    this.prepareInputBuffersToSend();
    this.processOLA(
      this.inputBuffersToSend,
      this.outputBuffersToRetrieve,
      parameters
    );
    this.handleOutputBuffersToRetrieve();
    this.writeOutputs(outputs);
    this.shiftOutputBuffers();

    return true;
  }

  abstract processOLA(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: AudioParamMap
  ): void;
}
