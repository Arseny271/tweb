import {render} from 'solid-js/web';
import PopupElement from '.';
import {i18n} from '../../lib/langPack';
import {attachClickEvent} from '../../helpers/dom/clickEvent';
import toggleDisability from '../../helpers/dom/toggleDisability';

import Section, {SectionCaption} from '../section';
import Row from '../row';
import {PhoneGroupCallStreamRtmpUrl} from '../../layer';
import ButtonIcon from '../buttonIcon';
import {copyTextToClipboard} from '../../helpers/clipboard';
import {toast} from '../toast';
import Icon, {getIconContent} from '../icon';
import appImManager from '../../lib/appManagers/appImManager';
import AppStreamViewer from '../appStreamViewer';
import liveStreamsController from '../../lib/streams/liveStreamsController';
import ListenerSetter from '../../helpers/listenerSetter';
import {AppManagers} from '../../lib/appManagers/managers';
import LiveStreamInstance from '../../lib/streams/liveStreamInstance';

const HIDDEN_KEY_TEXT = '.'.repeat(15);

export class StreamingKeyRows {
  private liveStreamRtmpUrl: PhoneGroupCallStreamRtmpUrl;
  private managers: AppManagers;
  private chatId: ChatId;

  public readonly liveStreamRtmpUrlRow: Row;
  public readonly liveStreamRtmpKeyRow: Row;
  private keyIsVisible: boolean;
  private instance?: LiveStreamInstance;

  constructor({
    instance,
    chatId,
    managers,
    listenerSetter}:
  {
    instance?: LiveStreamInstance
    chatId: ChatId,
    managers: AppManagers,
    listenerSetter: ListenerSetter
  }) {
    this.instance = instance;
    this.chatId = chatId;
    this.managers = managers;

    const linkCopyBtn = ButtonIcon('copy');
    const keyCopyBtn = ButtonIcon('copy');
    const showKeyBtn = Icon('eye1', 'button-icon');

    const copyLink = (e: Event) => {
      if(e) {
        e.stopPropagation()
      }
      toast(i18n('LinkCopied'));
      copyTextToClipboard(this.liveStreamRtmpUrl.url);
    }

    const copyKey = (e: Event) => {
      if(e) {
        e.stopPropagation()
      }
      toast(i18n('LinkCopied'));
      copyTextToClipboard(this.liveStreamRtmpUrl.key);
    }

    this.liveStreamRtmpUrlRow = new Row({
      icon: 'link',
      title: 'Loading...',
      subtitleLangKey: 'StreamingRTMP.Server.Url',
      listenerSetter, clickable: copyLink
    });
    this.liveStreamRtmpUrlRow.container.classList.add('row-with-copy-button');
    this.liveStreamRtmpUrlRow.container.append(linkCopyBtn);

    this.liveStreamRtmpKeyRow = new Row({
      icon: 'lock',
      title: HIDDEN_KEY_TEXT,
      listenerSetter, clickable: copyKey
    });
    this.liveStreamRtmpKeyRow.container.classList.add('row-with-copy-button');
    this.liveStreamRtmpKeyRow.subtitle.append(i18n('StreamingRTMP.Server.Key'));
    this.liveStreamRtmpKeyRow.subtitle.append(showKeyBtn);
    this.liveStreamRtmpKeyRow.container.append(keyCopyBtn);

    if(this.instance) {
      if(listenerSetter) {
        listenerSetter.add(this.instance)('rtmp', this.setRtmpKey);
      } else {
        this.instance.addEventListener('rtmp', this.setRtmpKey)
      }
    }

    attachClickEvent(showKeyBtn, (e) => {
      this.keyIsVisible = !this.keyIsVisible;
      this.liveStreamRtmpKeyRow.title.textContent = this.keyIsVisible ?
        this.liveStreamRtmpUrl.key: HIDDEN_KEY_TEXT;
      showKeyBtn.innerText = getIconContent(this.keyIsVisible ? 'eye2': 'eye1');
      e.stopPropagation();
    }, {listenerSetter});

    attachClickEvent(linkCopyBtn, copyLink, {listenerSetter});

    attachClickEvent(keyCopyBtn, copyKey, {listenerSetter});
  }

  public onRtmpServerRevoke = async(revoke: boolean)=> {
    this.setRtmpKey(this.instance ? await this.instance.requestLiveStreamRtmpUrl(revoke):
      await this.managers.appGroupCallsManager.getGroupCallStreamRtmpUrl(this.chatId, revoke));
    if(revoke) {
      toast(i18n('LiveStream.Toast.Revoked'));
    }
  }

  public async construct() {
    this.setRtmpKey(this.instance ? await this.instance.getOrRequestRtmpUrl():
      await this.managers.appGroupCallsManager.getGroupCallStreamRtmpUrl(this.chatId, false));
  }

  private setRtmpKey = (rtmp: StreamingKeyRows['liveStreamRtmpUrl'])=> {
    this.liveStreamRtmpUrl = rtmp;
    this.liveStreamRtmpUrlRow.title.textContent = this.liveStreamRtmpUrl.url;
    if(this.keyIsVisible) {
      this.liveStreamRtmpKeyRow.title.textContent = this.liveStreamRtmpUrl.key;
    }
  }
}

export default class PopupStartLiveStreamRTMP extends PopupElement {
  private keyRows: StreamingKeyRows;
  private peerId: PeerId;
  private mode: 'start' | 'settings';

  constructor(peerId: PeerId, mode: PopupStartLiveStreamRTMP['mode'] = 'start', instance?: LiveStreamInstance) {
    super('popup-livestream-start-with', {
      closable: true,
      overlayClosable: true,
      body: true,
      scrollable: true,
      title: mode === 'start' ? 'PeerInfo.Action.LiveStreamWith': 'StreamingRTMP.More.StreamSettings',
      footer: true,
      withConfirm: true,
      options: [{
        icon: 'stop', danger: true,
        text: 'StreamingRTMP.Action.Revoke',
        onClick: () => this.keyRows.onRtmpServerRevoke(true)
      }]
    });

    this.mode = mode;
    this.peerId = peerId;
    this.keyRows = new StreamingKeyRows({
      chatId: this.peerId.toChatId(), managers: this.managers, listenerSetter: this.listenerSetter, instance
    });

    // this.element.classList.remove('night');
    this.construct();
  }

  private _construct() {
    const revokeRow = new Row({
      icon: 'stop',
      iconClasses: ['danger'],
      titleLangKey: 'LiveStream.RevokeStreamKey',
      listenerSetter: this.listenerSetter,
      clickable: () => this.keyRows.onRtmpServerRevoke(true)
    })
    revokeRow.title.classList.add('danger');
    revokeRow.container.classList.add('danger');

    const ret = (
      <>
        <Section noDelimiter={true}>
          <SectionCaption caption={'StreamingRTMP.Caption.Url'}/>
          {this.keyRows.liveStreamRtmpUrlRow.container}
          {this.keyRows.liveStreamRtmpKeyRow.container}
          {this.mode === 'settings' && revokeRow.container}
          {this.mode === 'start' && <SectionCaption caption={'StreamingRTMP.Caption.Broadcast'}/>}
        </Section>
      </>
    );

    let s: HTMLSpanElement;
    const ss = (<span ref={s} class="popup-boosts-button-text">{i18n(this.mode === 'settings' ? 'StreamingRTMP.More.EndLiveStream': 'StreamingRTMP.Start')}</span>);
    if(this.mode === 'settings') {
      this.btnConfirm.classList.remove('btn-color-primary')
      this.btnConfirm.classList.add('btn-color-primary-danger')
    }
    this.btnConfirm.append(s);
    this.footer.append(this.btnConfirm);
    this.body.after(this.footer);
    this.footer.classList.add('abitlarger');

    attachClickEvent(this.btnConfirm, async() => {
      const toggle = toggleDisability(this.btnConfirm, true);
      try {
        if(this.mode === 'start') {
          appImManager.joinGroupCall(this.peerId, undefined, true).then(() => {
            AppStreamViewer.openStream(liveStreamsController.groupCall);
          })
        } else if(this.mode === 'settings') {
          const streamViewer = (window as any).appMediaViewer
          if(streamViewer instanceof AppStreamViewer) {
            streamViewer.close(true);
          } else {
            liveStreamsController.groupCall?.stopStream(true);
          }
        }
        this.hide();
      } catch(err) {
        console.error('boosts via gifts error', err);
        toggle();
      }
    }, {listenerSetter: this.listenerSetter});

    return ret;
  }

  private async construct() {
    await this.keyRows.construct();

    const div = document.createElement('div');
    this.scrollable.append(div);
    const dispose = render(() => this._construct(), div);
    this.addEventListener('closeAfterTimeout', dispose);
    this.show();
  }
}
