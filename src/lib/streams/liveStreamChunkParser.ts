import MP4Box from 'mp4box';
import safeAssign from '../../helpers/object/safeAssign';

type SegmentedTracksMap = {[key: number]: ArrayBuffer };

export class LiveStreamChunk {
  public readonly duration: number;
  public readonly timestamp: number;
  public readonly info: MP4Box.Mp4Box_info;
  public readonly tracks: SegmentedTracksMap;

  public constructor(options:{info: MP4Box.Mp4Box_info, tracks: SegmentedTracksMap, duration: number, timestamp: number}) {
    safeAssign(this, options);
  }

  public getAudioTrack() {
    for(const track of this.info.audioTracks) {
      const codec = `audio/mp4; codecs="${track.codec.toLowerCase()}"`;
      if(MediaSource.isTypeSupported(codec)) {
        return {codec, track, buffer: this.tracks[track.id]};
      }
    }
  }

  public getVideoTrack() {
    for(const track of this.info.videoTracks) {
      const codec = `video/mp4; codecs="${track.codec}"`;
      if(MediaSource.isTypeSupported(codec)) {
        return {codec, track, buffer: this.tracks[track.id]};
      }
    }
  }
}

export class LiveStreamChunkParser {
  private readonly callback: (i: {info: MP4Box.Mp4Box_info; tracks: SegmentedTracksMap; }) => void;

  private readonly mp4boxFile: any;
  private mp4boxFileInfo: MP4Box.Mp4Box_info;
  private readonly mp4boxFileSegments: {[key: number]: ArrayBuffer[] } = {};
  private readonly mp4boxFileSegmentedTracks: SegmentedTracksMap = {};

  public static async parse(buffer: Uint8Array, duration: number, timestamp: number, isLiveStreamPart: boolean = true): Promise<LiveStreamChunk> {
    return new Promise((resolve, reject) => {
      new LiveStreamChunkParser(isLiveStreamPart ? buffer.slice(32).buffer: buffer.buffer, e => resolve(new LiveStreamChunk({
        info: e.info, tracks: e.tracks, duration, timestamp
      })), i => reject(i));
    });
  }

  private constructor(buffer: ArrayBuffer, onSuccess: LiveStreamChunkParser['callback'], onError: (e: Error) => void) {
    this.callback = onSuccess;
    this.mp4boxFile = MP4Box.createFile();
    this.mp4boxFile.onError = (e: Error) => onError(e);
    this.mp4boxFile.onReady = this.onMp4boxReady.bind(this);

    (buffer as any).fileStart = 0;
    this.mp4boxFile.appendBuffer(buffer);
    this.mp4boxFile.flush();
  }

  private onMp4boxReady(info: any) {
    this.mp4boxFile.onSegment = this.onMp4boxSegment.bind(this);
    this.mp4boxFileInfo = info;

    for(const track of info.tracks) {
      this.mp4boxFile.setSegmentOptions(track.id, null, {nbSamples: 1000000});
    }
    const initialSegments = this.mp4boxFile.initializeSegmentation();
    for(const segment of initialSegments) {
      this.mp4boxFileSegments[segment.id] = [segment.buffer];
    }
    this.mp4boxFile.start();
  }

  private onMp4boxSegment(id: number, user: any, buffer: ArrayBuffer, sampleNumber: number, isLast: boolean) {
    this.mp4boxFileSegments[id].push(buffer);
    if(isLast) {
      this.mp4boxFileSegmentedTracks[id] = LiveStreamChunkParser.concatenateArrayBuffers(this.mp4boxFileSegments[id]);
      delete this.mp4boxFileSegments[id];
      if(!Object.keys(this.mp4boxFileSegments).length) {
        this.onMp4boxSegmentationReady();
      }
    }
  }

  private onMp4boxSegmentationReady() {
    for(const track of this.mp4boxFileInfo.audioTracks) {
      if(track.codec === 'Opus' && track.audio.channel_count === 1) {
        LiveStreamChunkParser.pathStsdAtom(this.mp4boxFileSegmentedTracks[track.id]);
      }
    }

    this.callback({info: this.mp4boxFileInfo, tracks: this.mp4boxFileSegmentedTracks});
  }

  private static concatenateArrayBuffers(arrays: ArrayBuffer[]): ArrayBuffer {
    const totalLength = arrays.reduce((acc, arr) => acc + arr.byteLength, 0);
    const concatenatedBuffer = new ArrayBuffer(totalLength);
    const concatenatedView = new Uint8Array(concatenatedBuffer);

    let offset = 0;
    arrays.forEach((buffer) => {
      const sourceView = new Uint8Array(buffer);
      concatenatedView.set(sourceView, offset);
      offset += buffer.byteLength;
    });

    return concatenatedBuffer;
  }


  /* WARNING: Unsafe function!!! Todo: fix */

  private static pathStsdAtom(buffer: ArrayBuffer): ArrayBuffer {
    const sequence = new Uint8Array([115, 116, 115, 100]);
    const uint8Array = new Uint8Array(buffer);

    for(let i = 0; i < uint8Array.length - sequence.length + 1; i++) {
      let found = true;
      for(let j = 0; j < sequence.length; j++) {
        if(uint8Array[i + j] !== sequence[j]) {
          found = false;
          break;
        }
      }
      if(found) {
        uint8Array[i + 0x25] = 2;
        return uint8Array.buffer;
      }
    }
    return buffer;
  }
}
