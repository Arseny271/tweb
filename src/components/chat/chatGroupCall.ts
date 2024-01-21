import PinnedContainer from './pinnedContainer';
import type ChatTopbar from './topbar';
import Chat from './chat';
import {AppManagers} from '../../lib/appManagers/managers';
import DivAndCaption from '../divAndCaption';
import replaceContent from '../../helpers/dom/replaceContent';
import wrapReply from '../wrappers/reply';
import Button from '../button';
import {attachClickEvent} from '../../helpers/dom/clickEvent';
import cancelEvent from '../../helpers/dom/cancelEvent';
import AppStreamViewer from '../appStreamViewer';
import liveStreamsController from '../../lib/streams/liveStreamsController';
import {GroupCall} from '../../layer';
import {i18n} from '../../lib/langPack';
import {MyGroupCall} from '../../lib/appManagers/appGroupCallsManager';
import rootScope from '../../lib/rootScope';

export default class ChatGroupCall extends PinnedContainer {
  private joinBtn: HTMLButtonElement;
  private counter: HTMLElement;

  constructor(protected topbar: ChatTopbar, protected chat: Chat, protected managers: AppManagers) {
    super({topbar, chat,
      listenerSetter: topbar.listenerSetter,
      className: 'group-call',
      divAndCaption: new DivAndCaption(
        'pinned-group-call',
        (options) => {

        }
      ),
      onClose: () => {},
      floating: true,
      hideButtons: true,
      noRipple: true
    });

    const attachClick = (elem: HTMLElement, callback: () => void) => {
      attachClickEvent(elem, (e) => {
        cancelEvent(e);
        callback();
      }, {listenerSetter: this.topbar.listenerSetter});
    };

    this.joinBtn = Button('group-call-join-button', {
      text: 'StreamingRTMP.Join'
    });

    this.counter = wrapReply({
      title: 'Live stream',
      subtitle: 'X Watching',
      noHover: true
    }).container;

    this.counter.append(this.joinBtn);
    replaceContent(this.divAndCaption.content, this.counter);

    attachClick(this.joinBtn, () => {
      this.chat.appImManager.joinGroupCall(this.chat.peerId).then(() => {
        if(liveStreamsController.groupCall) {
          AppStreamViewer.openStream(liveStreamsController.groupCall);
        }
      });
    });

    this.listenerSetter.add(rootScope)('group_call_update', (groupCall) => {
      if(this.groupCall?.id === groupCall.id) {
        this.setGroupCall(undefined, groupCall, false);
      }
    })
  }

  private groupCall: MyGroupCall;
  private ctxId = 0;

  public setGroupCall(chatId: ChatId, groupCall: GroupCall, allowRequest: boolean = true) {
    if(!groupCall && allowRequest && chatId) {
      this.toggle(true);

      const ctx = this.ctxId;
      const full = this.managers.appChatsManager.isChannel(chatId) ?
        this.managers.appProfileManager.getChannelFull(chatId):
        this.managers.appProfileManager.getChatFull(chatId);

      full.then(full => {
        if(full.call) {
          return this.managers.appGroupCallsManager.getGroupCallFull(full.call.id, false)
        }
      }).then(call => {
        if(call && this.ctxId === ctx) {
          this.setGroupCall(chatId, call, false)
        }
      })
      return;
    }
    if(!groupCall || groupCall._ === 'groupCallDiscarded') {
      this.toggle(true);
      return;
    }

    replaceContent(this.divAndCaption.content, this.counter = wrapReply({
      title: i18n(groupCall.pFlags.rtmp_stream ? 'LiveStream.TopBar.LiveStream': 'LiveStream.TopBar.GroupCall').textContent,
      subtitle: i18n(groupCall.pFlags.rtmp_stream ? 'LiveStream.Watching': 'LiveStream.TopBar.GroupCall.Members', [groupCall.participants_count]).textContent,
      noHover: true
    }).container);
    this.counter.append(this.joinBtn);
    this.groupCall = groupCall;

    this.toggle(false);
  }

  private update(groupCall: GroupCall) {}

  public toggle(hide?: boolean) {
    if(hide) {
      this.ctxId += 1;
    }
    super.toggle(hide);
  }

  public destroy() {

  }
}

/*
import PinnedContainer from './pinnedContainer';
import type ChatTopbar from './topbar';
import Chat from './chat';
import {AppManagers} from '../../lib/appManagers/managers';
import DivAndCaption from '../divAndCaption';
import replaceContent from '../../helpers/dom/replaceContent';
import wrapReply from '../wrappers/reply';
import Button from '../button';
import {attachClickEvent} from '../../helpers/dom/clickEvent';
import cancelEvent from '../../helpers/dom/cancelEvent';
import AppStreamViewer from '../appStreamViewer';
import liveStreamsController from '../../lib/streams/liveStreamsController';
import {GroupCall} from '../../layer';
import {i18n} from '../../lib/langPack';
import {MyGroupCall} from '../../lib/appManagers/appGroupCallsManager';
import rootScope from '../../lib/rootScope';

export default class ChatGroupCall extends PinnedContainer {
  private joinBtn: HTMLButtonElement;
  private counter: HTMLElement;

  constructor(protected topbar: ChatTopbar, protected chat: Chat, protected managers: AppManagers) {
    super({topbar, chat,
      listenerSetter: topbar.listenerSetter,
      className: 'group-call',
      divAndCaption: new DivAndCaption(
        'pinned-group-call',
        (options) => {

        }
      ),
      onClose: () => {},
      floating: true,
      hideButtons: true,
      noRipple: true
    });

    const attachClick = (elem: HTMLElement, callback: () => void) => {
      attachClickEvent(elem, (e) => {
        cancelEvent(e);
        callback();
      }, {listenerSetter: this.topbar.listenerSetter});
    };

    this.joinBtn = Button('group-call-join-button', {
      text: 'StreamingRTMP.Join'
    });

    this.counter = wrapReply({
      title: 'Live stream',
      subtitle: 'X Watching',
      noHover: true
    }).container;

    this.counter.append(this.joinBtn);
    replaceContent(this.divAndCaption.content, this.counter);

    attachClick(this.joinBtn, () => {
      this.chat.appImManager.joinGroupCall(this.chat.peerId).then(() => {
        if(liveStreamsController.groupCall) {
          AppStreamViewer.openStream(liveStreamsController.groupCall);
        }
      });
    });

    this.listenerSetter.add(rootScope)('group_call_update', (groupCall) => {
      if(this.groupCall?.id === groupCall.id && groupCall._ === 'groupCall') {
        this.update(groupCall);
      }
    })
  }

  private groupCall: MyGroupCall;
  private chatId: ChatId;
  private ctxId = 0;

  public setGroupCall(chatId: ChatId) {
    if(this.chatId === chatId) {
      return;
    }
    this.chatId = chatId;

    this.toggle(true);
    const ctx = this.ctxId;
    const full = this.managers.appChatsManager.isChannel(chatId) ?
      this.managers.appProfileManager.getChannelFull(chatId):
      this.managers.appProfileManager.getChatFull(chatId);

    full.then(full => {
      if(full.call) {
        return this.managers.appGroupCallsManager.getGroupCallFull(full.call.id, false)
      }
    }).then(groupCall => {
      if(!groupCall || groupCall._ === 'groupCallDiscarded') {
        this.toggle(true);
        return;
      } else {
        this.update(groupCall);
        this.toggle(false);
      }
    })
    return;
  }

  private update(groupCall: GroupCall.groupCall) {
    replaceContent(this.divAndCaption.content, this.counter = wrapReply({
      title: i18n(groupCall.pFlags.rtmp_stream ? 'LiveStream.TopBar.LiveStream': 'LiveStream.TopBar.GroupCall').textContent,
      subtitle: i18n(groupCall.pFlags.rtmp_stream ? 'LiveStream.Watching': 'LiveStream.TopBar.GroupCall.Members', [Math.max(groupCall.participants_count, 0)]).textContent,
      noHover: true
    }).container);
    this.counter.append(this.joinBtn);
    this.groupCall = groupCall;
  }

  public toggle(hide?: boolean) {
    if(hide) {
      this.ctxId += 1;
    }
    super.toggle(hide);
  }

  public destroy() {

  }
}
 */
