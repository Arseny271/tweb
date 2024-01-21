/*
 * https://github.com/morethanwords/tweb
 * Copyright (C) 2019-2021 Eduard Kuzmenko
 * https://github.com/morethanwords/tweb/blob/master/LICENSE
 */

import {IS_APPLE_MOBILE, IS_MOBILE} from '../environment/userAgent';
import IS_TOUCH_SUPPORTED from '../environment/touchSupport';
import cancelEvent from '../helpers/dom/cancelEvent';
import ListenerSetter, {Listener} from '../helpers/listenerSetter';
import {ButtonMenuSync} from '../components/buttonMenu';
import ControlsHover from '../helpers/dom/controlsHover';
import {addFullScreenListener, cancelFullScreen, isFullScreen, requestFullScreen} from '../helpers/dom/fullScreen';
import MediaProgressLine from '../components/mediaProgressLine';
import VolumeSelector from '../components/volumeSelector';
import debounce from '../helpers/schedulers/debounce';
import overlayCounter from '../helpers/overlayCounter';
import {attachClickEvent} from '../helpers/dom/clickEvent';
import safePlay from '../helpers/dom/safePlay';
import ButtonIcon from '../components/buttonIcon';
import Icon from '../components/icon';
import ButtonMenuToggle from '../components/buttonMenuToggle';
import PopupElement from '../components/popups';
import PopupStartLiveStreamRTMP from '../components/popups/livestreamStartRtmp';
import {GroupCall} from '../layer';
import PopupLiveStreamStartRecord from '../components/popups/livestreamStartRecord';
import {i18n} from './langPack';
import {AppManagers} from './appManagers/managers';
import rootScope from './rootScope';
import apiManagerProxy from './mtproto/mtprotoworker';
import hasRights from './appManagers/utils/chats/hasRights';
import LiveStreamInstance from './streams/liveStreamInstance';
import liveStreamsController from './streams/liveStreamsController';

const skin = 'stream';

export default class StreamPlayer extends ControlsHover {
  protected managers: AppManagers;

  protected video: HTMLVideoElement;
  protected wrapper: HTMLDivElement;
  protected progress: MediaProgressLine;

  protected leftControls: HTMLElement;
  protected recordingSpan: HTMLElement;

  protected listenerSetter: ListenerSetter;
  protected pipButton: HTMLElement;
  protected moreBtn: HTMLElement;

  protected instance: LiveStreamInstance;
  protected currentGroupCall: GroupCall;
  protected watchersSpan: HTMLSpanElement;

  protected onPip?: (pip: boolean) => void;
  protected onPipClose?: () => void;
  protected onClose?: () => void;

  constructor({
    video,
    play = false,
    duration,
    onPip,
    onPipClose,
    onClose,
    managers
  }: {
    managers: AppManagers;
    video: HTMLVideoElement,
    play?: boolean,
    duration?: number,
    onPip?: StreamPlayer['onPip'],
    onPipClose?: StreamPlayer['onPipClose'],
    onClose?: StreamPlayer['onClose'],
  }) {
    super();

    this.managers = managers;
    this.instance = liveStreamsController.groupCall;
    this.currentGroupCall = this.instance.groupCall;

    this.video = video;
    this.wrapper = document.createElement('div');
    this.wrapper.classList.add('ckin__player');

    this.onPip = onPip;
    this.onPipClose = onPipClose;
    this.onClose = onClose;

    this.listenerSetter = new ListenerSetter();

    this.setup({
      element: this.wrapper,
      listenerSetter: this.listenerSetter,
      canHideControls: () => {
        return !this.video.paused;
      },
      showOnLeaveToClassName: 'media-viewer-caption',
      ignoreClickClassName: 'ckin__controls'
    });

    video.parentNode.insertBefore(this.wrapper, video);
    this.wrapper.appendChild(video);

    this.stylePlayer(duration);
    this.setBtnMenuToggle();

    const controls = this.wrapper.querySelector('.stream__controls.ckin__controls') as HTMLDivElement
    this.progress = new MediaProgressLine({
      onSeekStart: () => {
        this.wrapper.classList.add('is-seeking');
      },
      onSeekEnd: () => {
        this.wrapper.classList.remove('is-seeking');
      }
    });
    this.progress.setMedia({
      media: video, streamable: true, duration
    });
    controls.prepend(this.progress.container);

    if(play/*  && video.paused */) {
      const promise = video.play();
      promise.catch((err: Error) => {
        if(err.name === 'NotAllowedError') {
          video.muted = true;
          video.autoplay = true;
          safePlay(video);
        }
      }).finally(() => { // due to autoplay, play will not call
        this.setIsPlaing(!this.video.paused);
      });
    }
  }

  private setIsPlaing(isPlaying: boolean) {
    this.wrapper.classList.toggle('is-playing', isPlaying);
  }

  private stylePlayer(initDuration: number) {
    const {wrapper, video, listenerSetter} = this;

    wrapper.classList.add(skin);

    const html = this.buildControls();
    wrapper.insertAdjacentHTML('beforeend', html);

    this.leftControls = wrapper.querySelector('.left-controls') as HTMLElement;

    if(!IS_MOBILE && document.pictureInPictureEnabled) {
      this.pipButton = ButtonIcon(`pip ${skin}__button`, {noRipple: true});
    }

    this.moreBtn = ButtonMenuToggle({
      listenerSetter: this.listenerSetter,
      direction: 'top-left',
      customIcon: 'more',
      /* {
        icon: 'volume_up',
        text: 'StreamingRTMP.More.OutputDevice',
        onClick: () => {}
      },*/
      buttons: [{
        icon: 'radioon',
        text: 'StreamingRTMP.More.StartRecording',
        onClick: () => PopupElement.createPopup(PopupLiveStreamStartRecord),
        verify: () => !this.isRecording && this.canManageStream()
      }, {
        icon: 'stop',
        text: 'StreamingRTMP.More.StopRecording',
        onClick: () => this.managers.appGroupCallsManager.stopGroupCallRecording(this.currentGroupCall.id),
        verify: () => this.isRecording && this.canManageStream()
      }, {
        icon: 'settings',
        text: 'StreamingRTMP.More.StreamSettings',
        onClick: () => PopupElement.createPopup(PopupStartLiveStreamRTMP, this.instance.chatId.toPeerId(), 'settings', this.instance),
        verify: () => this.isChannelOwner()
      }, {
        danger: true,
        icon: 'crossround',
        text: 'StreamingRTMP.More.EndLiveStream',
        onClick: () => this.onClose(),
        verify: () => this.canManageStream()
      }]
    });
    this.moreBtn.classList.add(`${skin}__button`);

    const fullScreenButton = ButtonIcon(` ${skin}__button`, {noRipple: true});
    const rightControls = wrapper.querySelector('.right-controls') as HTMLElement;
    rightControls.append(...[this.moreBtn, this.pipButton, fullScreenButton].filter(Boolean));

    const volumeSelector = new VolumeSelector(listenerSetter);
    volumeSelector.btn.classList.remove('btn-icon');
    this.leftControls.append(volumeSelector.btn);

    if(this.pipButton) {
      attachClickEvent(this.pipButton, () => {
        this.video.requestPictureInPicture();
      }, {listenerSetter: this.listenerSetter});

      const onPip = (pip: boolean) => {
        this.instance.dispatchEvent('pip', true);
        this.wrapper.style.visibility = pip ? 'hidden': '';
        if(this.onPip) {
          this.onPip(pip);
        }
      };

      const debounceTime = 20;
      const debouncedPip = debounce(onPip, debounceTime, false, true);

      listenerSetter.add(video)('enterpictureinpicture', () => {
        debouncedPip(true);

        listenerSetter.add(video)('leavepictureinpicture', () => {
          const onPause = () => {
            this.instance.dispatchEvent('pip', false);
            clearTimeout(timeout);
            if(this.onPipClose) {
              this.onPipClose();
            }
          };
          const listener = listenerSetter.add(video)('pause', onPause, {once: true}) as any as Listener;
          const timeout = setTimeout(() => {
            listenerSetter.remove(listener);
          }, debounceTime);
        }, {once: true});
      });

      listenerSetter.add(video)('leavepictureinpicture', () => {
        debouncedPip(false);
      });
    }

    if(!IS_TOUCH_SUPPORTED) {
      listenerSetter.add(document)('keydown', (e: KeyboardEvent) => {
        if(overlayCounter.overlaysActive > 1 || document.pictureInPictureElement === video) { // forward popup is active, etc
          return;
        }

        const {key, code} = e;

        let good = true;
        if(code === 'KeyF') {
          this.toggleFullScreen();
        } else {
          good = false;
        }

        if(good) {
          cancelEvent(e);
          return false;
        }
      });
    }

    this.checkRecording();
    if(this.instance?.groupCall?._ === 'groupCall') {
      this.checkWatchers(this.instance.groupCall.participants_count);
    }

    listenerSetter.add(rootScope)('group_call_update', groupCall => {
      if(this.instance?.groupCall?.id === groupCall.id && groupCall._ === 'groupCall') {
        this.checkWatchers(groupCall.participants_count);
      }
    });

    listenerSetter.add(video)('dblclick', () => {
      if(!IS_TOUCH_SUPPORTED) {
        this.toggleFullScreen();
      }
    });

    attachClickEvent(fullScreenButton, () => {
      this.toggleFullScreen();
    }, {listenerSetter: this.listenerSetter});

    addFullScreenListener(wrapper, this.onFullScreen.bind(this, fullScreenButton), listenerSetter);
    this.onFullScreen(fullScreenButton);

    listenerSetter.add(video)('play', () => {
      wrapper.classList.add('played');

      if(!IS_TOUCH_SUPPORTED) {
        listenerSetter.add(video)('play', () => {
          this.hideControls(true);
        });
      }
    }, {once: true});

    listenerSetter.add(video)('pause', () => {
      this.showControls(false);
    });

    listenerSetter.add(video)('play', () => {
      this.setIsPlaing(true);
    });

    listenerSetter.add(video)('pause', () => {
      this.setIsPlaing(false);
    });

    listenerSetter.add(rootScope)('group_call_update', (groupCall) => {
      if(this.currentGroupCall?.id === groupCall.id) {
        this.updateCurrentGroupCall(groupCall);
      }
    });
  }

  private buildControls() {
    return `
    <div class="${skin}__gradient-bottom ckin__controls"></div>
    <div class="${skin}__controls ckin__controls">
      <div class="bottom-controls">
        <div class="left-controls">
          <div class="live-span-wrapper">
            <span>LIVE</span>
            </div>
        </div>
        <div class="right-controls"></div>
      </div>
    </div>`;
  }

  private checkWatchers(count: number) {
    if(!this.watchersSpan) {
      this.watchersSpan = document.createElement('span');
      this.watchersSpan.classList.add('stream-watchers-span');
      this.watchersSpan.append(i18n('LiveStream.Watching', [count]));
      this.leftControls.append(this.watchersSpan);
    } else {
      this.watchersSpan.children[0].replaceWith(i18n('LiveStream.Watching', [count]));
    }
  }

  private checkRecording() {
    const isRecording = this.isRecording && this.canManageStream();
    if(isRecording) {
      if(!this.recordingSpan) {
        this.recordingSpan = this.buildRecordingSpan();
      }
      if(!this.recordingSpan.isConnected) {
        this.leftControls.append(this.recordingSpan);
      }
    } else if(this.recordingSpan && this.recordingSpan.isConnected) {
      this.leftControls.removeChild(this.recordingSpan)
    }
  }

  private buildRecordingSpan() {
    const span = document.createElement('span');
    span.classList.add('recording-span');
    span.append(i18n('StreamingRTMP.Recording'))
    return span;
  }

  protected setBtnMenuToggle() {
    const btnMenu = ButtonMenuSync({buttons: []});
    btnMenu.classList.add('top-left');
  }

  protected toggleFullScreen() {
    const player = this.wrapper;

    // * https://caniuse.com/#feat=fullscreen
    if(IS_APPLE_MOBILE) {
      const video = this.video as any;
      video.webkitEnterFullscreen();
      video.enterFullscreen();
      return;
    }

    if(!isFullScreen()) {
      requestFullScreen(player);
    } else {
      cancelFullScreen();
    }
  }

  protected onFullScreen(fullScreenButton: HTMLElement) {
    const isFull = isFullScreen();
    this.wrapper.classList.toggle('ckin__fullscreen', isFull);
    if(!isFull) {
      fullScreenButton.replaceChildren(Icon('fullscreen'));
      fullScreenButton.setAttribute('title', 'Full Screen');
    } else {
      fullScreenButton.replaceChildren(Icon('smallscreen'));
      fullScreenButton.setAttribute('title', 'Exit Full Screen');
    }
  }

  public cleanup() {
    super.cleanup();
    this.listenerSetter.removeAll();
    this.progress.removeListeners();
    this.onPip = undefined;
  }

  private updateCurrentGroupCall(groupCall: GroupCall) {
    this.currentGroupCall = groupCall;
    this.checkRecording();
  }

  private get isRecording() {
    return this.currentGroupCall && this.currentGroupCall._ === 'groupCall' && this.currentGroupCall.pFlags.record_video_active;
  }

  private canManageStream() {
    const chat = apiManagerProxy.getChat(this.instance.chatId);
    return hasRights(chat, 'manage_call');
  }

  private isChannelOwner() {
    const chat = apiManagerProxy.getChat(this.instance.chatId);
    return chat._ === 'channel' && chat.pFlags.creator;
  }
}
