import {AppManagers} from '../appManagers/managers';
import type {GroupCallId} from '../appManagers/appGroupCallsManager';
import safeAssign from '../../helpers/object/safeAssign';
import {GroupCall, PhoneGroupCallStreamRtmpUrl} from '../../layer';
import EventListenerBase from '../../helpers/eventListenerBase';
import LiveStreamConnectionInstance from './liveStreamConnectionInstance';
import LIVE_STREAM_STATE from './liveStreamState';
import {LiveStreamChunk} from './liveStreamChunkParser';

export default class LiveStreamInstance extends EventListenerBase<{
  state: (state: LIVE_STREAM_STATE) => void,
  chunk: (chunk: LiveStreamChunk) => void,
  rtmp: (rtmp: PhoneGroupCallStreamRtmpUrl) => void,
  pip: (pip: boolean) => void
}> {
  public id: GroupCallId;
  public chatId: ChatId;
  public groupCall: GroupCall;
  public liveStreamRtmpUrl: PhoneGroupCallStreamRtmpUrl;

  public connection: LiveStreamConnectionInstance;
  public lastReceivedChunk: LiveStreamChunk;
  public managers: AppManagers;

  constructor(options: {
    id: LiveStreamInstance['id'],
    chatId: LiveStreamInstance['chatId'],
    managers: AppManagers
  }) {
    super();
    safeAssign(this, options);

    this.addEventListener('state', (state) => {
      if(state === LIVE_STREAM_STATE.CLOSED) {
        this.cleanup();
      }
    });
  }

  public async requestLiveStreamRtmpUrl(revoke?: boolean) {
    this.liveStreamRtmpUrl = await this.managers.appGroupCallsManager.getGroupCallStreamRtmpUrl(this.chatId, revoke);
    this.dispatchEvent('rtmp', this.liveStreamRtmpUrl);
    return this.liveStreamRtmpUrl;
  }

  public async getOrRequestRtmpUrl() {
    if(this.liveStreamRtmpUrl) {
      return this.liveStreamRtmpUrl;
    } else {
      return this.requestLiveStreamRtmpUrl(false);
    }
  }

  public onReceiveChunk(chunk: LiveStreamChunk) {
    this.lastReceivedChunk = chunk;
    this.dispatchEvent('chunk', chunk);
  }

  public createConnectionInstance() {
    return this.connection = new LiveStreamConnectionInstance(this, this.managers);
  }

  public async stopStream(discard: boolean) {
    this.connection.stop();

    this.managers.appGroupCallsManager.hangUp(this.id, discard || 0);
  }

  get state() {
    return this.connection.state;
  }

  public get isMuted() {
    return this.state !== LIVE_STREAM_STATE.CONNECTED;
  }

  public get isClosing() {
    const {state} = this;
    return state === LIVE_STREAM_STATE.CLOSED;
  }
}
