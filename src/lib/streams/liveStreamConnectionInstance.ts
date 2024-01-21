import {GroupCall, GroupCallStreamChannel, InputGroupCall, PhoneGroupCallStreamChannels, UploadFile} from '../../layer';
import LIVE_STREAM_STATE from './liveStreamState';
import {AppManagers} from '../appManagers/managers';
import {LiveStreamChunkParser} from './liveStreamChunkParser';
import LiveStreamInstance from './liveStreamInstance';

const TARGET_DELAY = 3000;

export default class LiveStreamConnectionInstance {
  private readonly managers: AppManagers;
  private readonly groupCall: GroupCall.groupCall;
  private readonly instance: LiveStreamInstance;
  private _state: LIVE_STREAM_STATE = LIVE_STREAM_STATE.NO_STREAM;

  constructor(streamInstance: LiveStreamInstance, managers: AppManagers) {
    this.instance = streamInstance;
    this.groupCall = streamInstance.groupCall as GroupCall.groupCall;
    this.managers = managers;
  }

  public async start() {
    return this.waitStreamChannels();
  }

  private async fetchFile(channelId: number, timestamp: number, scale: number, attempts: number = 0): Promise<UploadFile.uploadFile> {
    const file = await this.managers.apiManager.invokeApi('upload.getFile', {
      offset: 0, limit: 128 * 1024, location: {
        _: 'inputGroupCallStream',
        call: this.inputGroupCall,
        time_ms: timestamp,
        scale: scale,
        video_channel: channelId,
        video_quality: 2
      }
    }, {
      dcId: this.groupCall.stream_dc_id,
      timeout: 5000
    }).catch(err => {
      if(attempts > 2) {
        throw err;
      } else if(err.type === 'TIME_TOO_BIG') {
        this.streamFirstChunkTimestamp -= this.streamCurrentTimeframe;
        console.error('[LIVESTREAM] DROP CHUNK', timestamp);
        // return this.fetchFile(channelId, timestamp, scale, attempts + 1);
      } else if(err.type === 'TIME_INVALID') {
        this.state = LIVE_STREAM_STATE.CLOSED; // todo: rejoin ?
      } else if(err.type === 'GROUPCALL_JOIN_MISSING') {
        this.state = LIVE_STREAM_STATE.CLOSED; // todo: rejoin ?
      }

      throw err;
    });

    if(file._ !== 'upload.file') {
      throw new Error('Illegal state');
    }

    return file;
  }

  /* * */

  private channels: PhoneGroupCallStreamChannels.phoneGroupCallStreamChannels['channels'];
  private currentChannel: GroupCallStreamChannel;

  private streamFirstChunkTimestamp: number;
  private streamFirstChunkTime: number;
  private streamLastDownloadingTimestamp: number;
  private streamCurrentTimeframe: number;
  private streamTargetDelay: number;

  private async setCurrentChannel(chanel: GroupCallStreamChannel) {
    this.state = LIVE_STREAM_STATE.CONNECTING;
    this.currentChannel = chanel;
    this.streamCurrentTimeframe = LiveStreamConnectionInstance.getDuration(chanel.scale);
    this.streamFirstChunkTimestamp = parseInt(chanel.last_timestamp_ms.toString());
    this.streamFirstChunkTime = performance.now();

    this.streamTargetDelay = 0;
    while(this.streamTargetDelay < TARGET_DELAY) this.streamTargetDelay += this.streamCurrentTimeframe;
    this.streamLastDownloadingTimestamp = this.streamFirstChunkTimestamp - this.streamTargetDelay;

    if(this.streamLastDownloadingTimestamp < 0) {
      this.streamLastDownloadingTimestamp = 0;
    }

    this.startDownloadFiles();
  }

  private get streamLastAvailableTimestamp() {
    const t = performance.now() - this.streamFirstChunkTime;
    return this.streamFirstChunkTimestamp + Math.floor(t / this.streamCurrentTimeframe) * this.streamCurrentTimeframe;
  }

  private get timeToNextRequest() {
    const t = this.streamFirstChunkTimestamp + performance.now() - this.streamFirstChunkTime;
    return this.streamLastDownloadingTimestamp - t + this.streamCurrentTimeframe;
  }

  private async waitStreamChannels() {
    this.state = LIVE_STREAM_STATE.CONNECTING;
    while(true) {
      try {
        this.channels = (await this.managers.appGroupCallsManager.getLivestreamChannels(this.groupCall.id)).channels;
        for(const channel of this.channels) {
          if(channel.channel == 1 && channel.scale == 0) { // 0_0
            this.setCurrentChannel(channel);
            return;
          }
        }
      } catch(e) {
        console.error('[LIVESTREAM] ERROR: channels', e);
        this.state = LIVE_STREAM_STATE.CLOSED;
        return;
      }
      if(this.isStopped) {
        return;
      }
      this.state = LIVE_STREAM_STATE.NO_STREAM;
      await this.sleep(1000);
    }
  }

  private async sleep(timeout: number) {
    if(timeout <= 0) {
      return;
    }
    return new Promise<void>(r => setTimeout(r, timeout));
  }

  /* * */

  private async startDownloadFiles() {
    while(!this.isStopped) {
      const end = this.streamLastAvailableTimestamp;
      while((end - this.streamLastDownloadingTimestamp) > (this.streamCurrentTimeframe * 5)) {
        console.error('[LIVESTREAM] DROP CHUNK', this.streamLastDownloadingTimestamp)
        this.streamLastDownloadingTimestamp += this.streamCurrentTimeframe;
      }
      while(this.streamLastDownloadingTimestamp < end) {
        const duration = this.streamCurrentTimeframe;
        const timestamp = this.streamLastDownloadingTimestamp;
        this.streamLastDownloadingTimestamp += this.streamCurrentTimeframe;
        const streamChunk = await this.fetchFile(this.currentChannel.channel, timestamp, this.currentChannel.scale)
        .then(file => LiveStreamChunkParser.parse(file.bytes, duration, timestamp))
        .catch(err => {
          console.error('[LIVESTREAM] Error:', err);
        });
        if(streamChunk) {
          this.instance.onReceiveChunk(streamChunk);
          this.state = LIVE_STREAM_STATE.CONNECTED;
        } else {
          this.state = LIVE_STREAM_STATE.CONNECTING;
        }
      }

      const sleepTime = this.timeToNextRequest
      console.log('[LIVESTREAM] Chunk Loading sleep:', sleepTime);
      await this.sleep(sleepTime);
    }
  }

  /* * */

  public stop() {
    this.state = LIVE_STREAM_STATE.CLOSED;
  }

  public get isStopped() {
    return this.state === LIVE_STREAM_STATE.CLOSED;
  }

  public get state() {
    return this._state;
  }

  private set state(state: LIVE_STREAM_STATE) {
    if(this._state !== state && this._state !== LIVE_STREAM_STATE.CLOSED) {
      this._state = state;
      this.instance.dispatchEvent('state', state);
    }
  }

  private get inputGroupCall(): InputGroupCall {
    return {
      _: 'inputGroupCall',
      id: this.groupCall.id,
      access_hash: this.groupCall.access_hash
    };
  }

  public static getDuration(scale: number) {
    return (scale >= 0) ? (1000 >> scale) : (1000 << (-scale))
  }
}
