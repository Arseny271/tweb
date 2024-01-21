import {MOUNT_CLASS_TO} from '../../config/debug';
import getGroupCallAudioAsset from '../../components/groupCall/getAudioAsset';
import {logger} from '../logger';
import GroupCallInstance from '../calls/groupCallInstance';
import {AppManagers} from '../appManagers/managers';
import rootScope from '../rootScope';
import {GroupCall} from '../../layer';
import StreamManager from '../calls/streamManager';
import createMainStreamManager from '../calls/helpers/createMainStreamManager';
import GROUP_CALL_STATE from '../calls/groupCallState';
import {GroupCallConnectionType} from '../appManagers/appGroupCallsManager';
import EventListenerBase from '../../helpers/eventListenerBase';
import LiveStreamInstance from './liveStreamInstance';
import LiveStreamConnectionInstance from './liveStreamConnectionInstance';
import LIVE_STREAM_STATE from './liveStreamState';
import {nextRandomUint} from '../../helpers/random';

export class LiveStreamsController extends EventListenerBase<{
  instance: (instance: LiveStreamInstance) => void
}> {
  private log: ReturnType<typeof logger>;
  private currentGroupCall: LiveStreamInstance;
  private managers: AppManagers;

  public construct(managers: AppManagers) {
    this.managers = managers;
    this.log = logger('GCC');

    rootScope.addEventListener('group_call_update', (groupCall) => {
      const {currentGroupCall} = this;
      if(currentGroupCall?.id === groupCall.id) {
        currentGroupCall.groupCall = groupCall;

        if(groupCall._ === 'groupCallDiscarded') {
          currentGroupCall.stopStream(false);
        }
      }
    });

    /* rootScope.addEventListener('group_call_participant', ({groupCallId, participant}) => {
      const {currentGroupCall} = this;
      if(currentGroupCall?.id === groupCallId) {
        currentGroupCall.onParticipantUpdate(participant);
      }
    });*/
  }

  get groupCall() {
    return this.currentGroupCall;
  }

  public setCurrentGroupCall(groupCall: LiveStreamInstance) {
    this.currentGroupCall = groupCall;

    if(groupCall) {
      this.dispatchEvent('instance', groupCall);
    }
  }

  public async joinGroupCall(chatId: ChatId, groupCall: GroupCall.groupCall) {
    this.log(`joinGroupCall chatId=${chatId} id=${groupCall.id}`);

    return this.joinGroupCallInternal(chatId, groupCall)
    /* .then(() => {
      // have to refresh participants because of the new connection
      const {currentGroupCall} = this;
      currentGroupCall.participants.then((participants) => {
        if(this.currentGroupCall !== currentGroupCall || currentGroupCall.state === GROUP_CALL_STATE.CLOSED) {
          return;
        }

        participants.forEach((participant) => {
          if(!participant.pFlags.self) {
            currentGroupCall.onParticipantUpdate(participant);
          }
        });
      });
    }); */
  }

  private async joinGroupCallInternal(chatId: ChatId, groupCall: GroupCall.groupCall) {
    const log = this.log.bindPrefix('joinGroupCallInternal');
    log('start', groupCall.id);

    const type: GroupCallConnectionType = 'main';

    let {currentGroupCall} = this;
    currentGroupCall = new LiveStreamInstance({
      chatId,
      id: groupCall.id,
      managers: this.managers
    });

    currentGroupCall.addEventListener('state', (state) => {
      if(this.currentGroupCall === currentGroupCall && state === LIVE_STREAM_STATE.CLOSED) {
        this.setCurrentGroupCall(null);
        rootScope.dispatchEvent('chat_update', currentGroupCall.chatId);
      }
    });

    currentGroupCall.groupCall = groupCall;
    currentGroupCall.connection = currentGroupCall.createConnectionInstance();

    this.setCurrentGroupCall(currentGroupCall);
    log('set currentGroupCall', currentGroupCall);

    const groupCallId = this.groupCall.id;
    const update = await this.managers.appGroupCallsManager.joinGroupCall(groupCallId, {
      _: 'dataJSON',
      data: JSON.stringify({'ssrc': nextRandomUint(32)})
    }, {
      type: 'main',
      isMuted: true,
      joinVideo: false
    }).then(() => {
      currentGroupCall.connection.start();
    });
    return;
  }
}

const liveStreamsController = new LiveStreamsController();
MOUNT_CLASS_TO && (MOUNT_CLASS_TO.liveStreamsController = liveStreamsController);
export default liveStreamsController;
