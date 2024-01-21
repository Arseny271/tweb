/*
 * https://github.com/morethanwords/tweb
 * Copyright (C) 2019-2021 Eduard Kuzmenko
 * https://github.com/morethanwords/tweb/blob/master/LICENSE
 */

// * zoom part from WebZ
// * https://github.com/Ajaxy/telegram-tt/blob/069f4f5b2f2c7c22529ccced876842e7f9cb81f4/src/components/mediaViewer/MediaViewerSlides.tsx

import deferredPromise from '../helpers/cancellablePromise';
import mediaSizes from '../helpers/mediaSizes';
import IS_TOUCH_SUPPORTED from '../environment/touchSupport';
import {IS_MOBILE_SAFARI} from '../environment/userAgent';
import {logger} from '../lib/logger';
import rootScope from '../lib/rootScope';
import animationIntersector from './animationIntersector';
import appMediaPlaybackController, {AppMediaPlaybackController} from './appMediaPlaybackController';
import ButtonIcon from './buttonIcon';
import {ButtonMenuItemOptions} from './buttonMenu';
import ButtonMenuToggle from './buttonMenuToggle';
import ProgressivePreloader from './preloader';
import SwipeHandler, {ZoomDetails} from './swipeHandler';
import appNavigationController, {NavigationItem} from './appNavigationController';
import findUpClassName from '../helpers/dom/findUpClassName';
import renderImageFromUrl, {renderImageFromUrlPromise} from '../helpers/dom/renderImageFromUrl';
import getVisibleRect from '../helpers/dom/getVisibleRect';
import cancelEvent from '../helpers/dom/cancelEvent';
import fillPropertyValue from '../helpers/fillPropertyValue';
import generatePathData from '../helpers/generatePathData';
import replaceContent from '../helpers/dom/replaceContent';
import {doubleRaf, fastRaf} from '../helpers/schedulers';
import RangeSelector from './rangeSelector';
import windowSize from '../helpers/windowSize';
import {NULL_PEER_ID} from '../lib/mtproto/mtproto_config';
import {isFullScreen} from '../helpers/dom/fullScreen';
import {attachClickEvent, hasMouseMovedSinceDown} from '../helpers/dom/clickEvent';
import createVideo from '../helpers/dom/createVideo';
import {AppManagers} from '../lib/appManagers/managers';
import wrapEmojiText from '../lib/richTextProcessor/wrapEmojiText';
import overlayCounter from '../helpers/overlayCounter';
import wrapPeerTitle from './wrappers/peerTitle';
import clamp from '../helpers/number/clamp';
import debounce from '../helpers/schedulers/debounce';
import isBetween from '../helpers/number/isBetween';
import findUpAsChild from '../helpers/dom/findUpAsChild';
import liteMode from '../helpers/liteMode';
import {avatarNew, findUpAvatar} from './avatarNew';
import {getMiddleware, MiddlewareHelper} from '../helpers/middleware';
import {replaceButtonIcon} from './button';
import setCurrentTime from '../helpers/dom/setCurrentTime';
import PopupForward from './popups/forward';
import StreamPlayer from '../lib/streamPlayer';
import liveStreamsController from '../lib/streams/liveStreamsController';
import PopupElement from './popups';
import PopupPeer from './popups/peer';
import apiManagerProxy from '../lib/mtproto/mtprotoworker';
import hasRights from '../lib/appManagers/utils/chats/hasRights';
import {makeMediaSize} from '../helpers/mediaSize';
import setAttachmentSize from '../helpers/setAttachmentSize';
import LiveStreamInstance from '../lib/streams/liveStreamInstance';
import SourceBufferSink from '../lib/streams/dashjs/streaming/SourceBufferSink';
import {StreamingKeyRows} from './popups/livestreamStartRtmp';
import {render} from 'solid-js/web';
import {i18n} from '../lib/langPack';
import LIVE_STREAM_STATE from '../lib/streams/liveStreamState';
import ListenerSetter from '../helpers/listenerSetter';
import {toast} from './toast';
import {LiveStreamChunk} from '../lib/streams/liveStreamChunkParser';

const ZOOM_STEP = 0.5;
const ZOOM_INITIAL_VALUE = 1;
const ZOOM_MIN_VALUE = 0.5;
const ZOOM_MAX_VALUE = 4;

export const MEDIA_VIEWER_CLASSNAME = 'media-viewer';

type Transform = {
  x: number;
  y: number;
  scale: number;
};

export default class AppStreamViewer {
  protected wholeDiv: HTMLElement;
  protected overlaysDiv: HTMLElement;
  protected author: {
    avatarEl: ReturnType<typeof avatarNew>,
    avatarMiddlewareHelper?: MiddlewareHelper,
    container: HTMLElement,
    nameEl: HTMLElement,
    date: HTMLElement
  } = {} as any;
  protected content: {[k in 'main' | 'container' | 'media' | 'mover']: HTMLElement} = {} as any;
  protected buttons: {[k in 'close' | 'mobile-close' | 'zoomin' | 'forward']: HTMLElement} = {} as any;
  protected topbar: HTMLElement;
  protected moversContainer: HTMLElement;

  protected oopsContainer: HTMLElement;
  protected oopsRows: StreamingKeyRows;

  protected tempId = 0;
  protected readonly preloader: ProgressivePreloader = null;

  protected log: ReturnType<typeof logger>;

  protected isFirstOpen = true;

  protected pageEl = document.getElementById('page-chats') as HTMLDivElement;

  protected setMoverPromise: Promise<void>;
  protected setMoverAnimationPromise: Promise<void>;

  protected highlightSwitchersTimeout: number;

  protected videoPlayer: StreamPlayer;

  protected zoomElements: {
    container: HTMLElement,
    btnOut: HTMLElement,
    btnIn: HTMLElement,
    rangeSelector: RangeSelector
  } = {} as any;
  protected transform: Transform = {x: 0, y: 0, scale: ZOOM_INITIAL_VALUE};
  protected isZooming: boolean;
  protected isGesturingNow: boolean;
  protected isZoomingNow: boolean;
  protected draggingType: 'wheel' | 'touchmove' | 'mousemove';
  protected initialContentRect: DOMRect;

  protected ctrlKeyDown: boolean;
  protected releaseSingleMedia: ReturnType<AppMediaPlaybackController['setSingleMedia']>;
  protected navigationItem: NavigationItem;

  protected managers: AppManagers;
  protected swipeHandler: SwipeHandler;
  protected closing: boolean;

  protected lastTransform: Transform = this.transform;
  protected lastZoomCenter: {x: number, y: number} = this.transform;
  protected lastDragOffset: {x: number, y: number} = this.transform;
  protected lastDragDelta: {x: number, y: number} = this.transform;
  protected lastGestureTime: number;
  protected clampZoomDebounced: ReturnType<typeof debounce<() => void>>;
  protected ignoreNextClick: boolean;

  protected middlewareHelper: MiddlewareHelper;
  private target: {element: HTMLElement};
  private listenerSetter: ListenerSetter;

  constructor() {
    this.managers = rootScope.managers;
    this.middlewareHelper = getMiddleware();

    this.log = logger('AMV');
    this.preloader = new ProgressivePreloader({
      cancelable: false,
      streamable: true
    });
    this.preloader.construct();
    this.listenerSetter = new ListenerSetter();

    this.wholeDiv = document.createElement('div');
    this.wholeDiv.classList.add(MEDIA_VIEWER_CLASSNAME + '-whole');

    this.overlaysDiv = document.createElement('div');
    this.overlaysDiv.classList.add('overlays');

    const mainDiv = document.createElement('div');
    mainDiv.classList.add(MEDIA_VIEWER_CLASSNAME);

    const topbar = this.topbar = document.createElement('div');
    topbar.classList.add(MEDIA_VIEWER_CLASSNAME + '-topbar', MEDIA_VIEWER_CLASSNAME + '-topbar-always-hover', MEDIA_VIEWER_CLASSNAME + '-appear');

    const topbarLeft = document.createElement('div');
    topbarLeft.classList.add(MEDIA_VIEWER_CLASSNAME + '-topbar-left');

    this.buttons['mobile-close'] = ButtonIcon('close', {onlyMobile: true});

    // * author
    this.author.container = document.createElement('div');
    this.author.container.classList.add(MEDIA_VIEWER_CLASSNAME + '-author', 'no-select', 'always-active');
    const authorRight = document.createElement('div');

    this.author.nameEl = document.createElement('div');
    this.author.nameEl.classList.add(MEDIA_VIEWER_CLASSNAME + '-name');

    this.author.date = document.createElement('div');
    this.author.date.classList.add(MEDIA_VIEWER_CLASSNAME + '-date');

    authorRight.append(this.author.nameEl, this.author.date);

    this.author.container.append(authorRight);

    // * buttons
    const buttonsDiv = document.createElement('div');
    buttonsDiv.classList.add(MEDIA_VIEWER_CLASSNAME + '-buttons');

    (['zoomin', 'forward', 'close'] as ('zoomin' | 'forward' | 'close')[]).forEach((name) => {
      const button = ButtonIcon(name as Icon, {noRipple: true});
      this.buttons[name] = button;
      buttonsDiv.append(button);
    });

    // * zoom
    this.zoomElements.container = document.createElement('div');
    this.zoomElements.container.classList.add('zoom-container');

    this.zoomElements.btnOut = ButtonIcon('zoomout', {noRipple: true});
    attachClickEvent(this.zoomElements.btnOut, () => this.addZoomStep(false));
    this.zoomElements.btnIn = ButtonIcon('zoomin', {noRipple: true});
    attachClickEvent(this.zoomElements.btnIn, () => this.addZoomStep(true));

    this.zoomElements.rangeSelector = new RangeSelector({
      step: 0.01,
      min: ZOOM_MIN_VALUE,
      max: ZOOM_MAX_VALUE,
      withTransition: true
    }, ZOOM_INITIAL_VALUE);
    this.zoomElements.rangeSelector.setListeners();
    this.zoomElements.rangeSelector.setHandlers({
      onScrub: (value) => {
        const add = value - this.transform.scale;
        this.addZoom(add);
        this.clampZoomDebounced?.clearTimeout();
      },
      onMouseDown: () => {
        this.onSwipeFirst();
      },
      onMouseUp: () => {
        this.onSwipeReset();
      }
    });

    this.zoomElements.container.append(this.zoomElements.btnOut, this.zoomElements.rangeSelector.container, this.zoomElements.btnIn);

    if(!IS_TOUCH_SUPPORTED) {
      this.wholeDiv.append(this.zoomElements.container);
    }

    // * content
    this.content.main = document.createElement('div');
    this.content.main.classList.add(MEDIA_VIEWER_CLASSNAME + '-content');

    this.content.container = document.createElement('div');
    this.content.container.classList.add(MEDIA_VIEWER_CLASSNAME + '-container');

    this.content.media = document.createElement('div');
    this.content.media.classList.add(MEDIA_VIEWER_CLASSNAME + '-media');

    this.content.container.append(this.content.media);

    this.content.main.append(this.content.container);
    mainDiv.append(this.content.main);
    this.overlaysDiv.append(mainDiv);
    // * overlays end

    topbarLeft.append(this.buttons['mobile-close'], this.author.container);
    topbar.append(topbarLeft, buttonsDiv);

    this.moversContainer = document.createElement('div');
    this.moversContainer.classList.add(MEDIA_VIEWER_CLASSNAME + '-movers');

    this.wholeDiv.append(this.overlaysDiv, /* this.buttons.prev, this.buttons.next, */ this.topbar, this.moversContainer);

    // * constructing html end

    this.setNewMover();
    this.setListeners();
  }

  protected buildOopsContainer() {
    this.oopsRows = new StreamingKeyRows({
      instance: this.instance,
      chatId: this.instance.chatId,
      managers: this.managers,
      listenerSetter: undefined
    });
    this.oopsRows.construct();
    this.oopsContainer = document.createElement('div');
    this.oopsContainer.classList.add('stream-oops-container', 'no-display', 'night');

    render(() => (<>
      <div class={'stream-oops-container-title'}>{i18n('LiveStream.Oops.Title')}</div>
      <div class={'stream-oops-container-caption'}>{i18n('LiveStream.Oops.Caption')}</div>
      {this.oopsRows.liveStreamRtmpUrlRow.container}
      {this.oopsRows.liveStreamRtmpKeyRow.container}
    </>), this.oopsContainer);
  }

  protected setListeners() {
    [this.buttons.close, this.buttons['mobile-close'], this.preloader.preloader].forEach((el) => {
      attachClickEvent(el, this.onLeaveClick.bind(this));
    });

    attachClickEvent(this.buttons.zoomin, () => {
      if(this.isZooming) this.resetZoom();
      else {
        this.addZoomStep(true);
      }
    });
    attachClickEvent(this.buttons.forward, () => {
      PopupForward.create({}, async(peerId, threadId) => {
        const url = await this.managers.appPeersManager.getPeerUsername(this.instance.chatId.toPeerId());
        return this.managers.appMessagesManager.sendText({peerId, threadId, text: `https://t.me/${url}?livestream`});
      });
    });

    // ! cannot use the function because it'll cancel slide event on touch devices
    // attachClickEvent(this.wholeDiv, this.onClick);
    this.wholeDiv.addEventListener('click', this.onClick);

    const adjustPosition = (xDiff: number, yDiff: number) => {
      const [x, y] = [xDiff - this.lastDragOffset.x, yDiff - this.lastDragOffset.y];
      const [transform, inBoundsX, inBoundsY] = this.calculateOffsetBoundaries({
        x: this.transform.x + x,
        y: this.transform.y + y,
        scale: this.transform.scale
      });

      this.lastDragDelta = {
        x,
        y
      };

      this.lastDragOffset = {
        x: xDiff,
        y: yDiff
      };

      this.setTransform(transform);

      return {inBoundsX, inBoundsY};
    };

    const setLastGestureTime = debounce(() => {
      this.lastGestureTime = Date.now();
    }, 500, false, true);

    this.clampZoomDebounced = debounce(() => {
      this.onSwipeReset();
    }, 300, false, true);

    this.swipeHandler = new SwipeHandler({
      element: this.wholeDiv,
      onReset: this.onSwipeReset,
      onFirstSwipe: this.onSwipeFirst as any,
      onSwipe: (xDiff, yDiff, e, cancelDrag) => {
        if(isFullScreen()) {
          return;
        }

        if(this.isZooming && !this.isZoomingNow) {
          setLastGestureTime();

          this.draggingType = e.type as any;
          const {inBoundsX, inBoundsY} = adjustPosition(xDiff, yDiff);
          cancelDrag?.(!inBoundsX, !inBoundsY);

          return;
        }

        if(this.isZoomingNow || !IS_TOUCH_SUPPORTED) {
          return;
        }

        const percents = Math.abs(xDiff) / windowSize.width;
        if(percents > .2 || Math.abs(xDiff) > 125) {
          return true;
        }

        const percentsY = Math.abs(yDiff) / windowSize.height;
        if(percentsY > .2 || Math.abs(yDiff) > 125) {
          this.onLeaveClick();
          return true;
        }

        return false;
      },
      onZoom: this.onZoom,
      onDoubleClick: ({centerX, centerY}) => {
        if(this.isZooming) {
          this.resetZoom();
        } else {
          const scale = ZOOM_INITIAL_VALUE + 2;
          this.changeZoomByPosition(centerX, centerY, scale);
        }
      },
      verifyTouchTarget: (e) => {
        // * Fix for seek input
        if(isFullScreen() ||
          findUpAsChild(e.target as HTMLElement, this.zoomElements.container) ||
          findUpClassName(e.target, 'ckin__controls') ||
          findUpClassName(e.target, 'media-viewer-caption') ||
          (findUpClassName(e.target, 'media-viewer-topbar') && e.type !== 'wheel')) {
          return false;
        }

        return true;
      },
      cursor: ''
      // cursor: 'move'
    });
  }

  protected onSwipeFirst = (e?: MouseEvent | TouchEvent | WheelEvent) => {
    this.lastDragOffset = this.lastDragDelta = {x: 0, y: 0};
    this.lastTransform = {...this.transform};
    if(e?.type !== 'wheel' || !this.ctrlKeyDown) { // keep transition for real mouse wheel
      this.moversContainer.classList.add('no-transition');
      this.zoomElements.rangeSelector.container.classList.remove('with-transition');
    }
    this.isGesturingNow = true;
    this.lastGestureTime = Date.now();
    this.clampZoomDebounced.clearTimeout();

    if(!this.lastTransform.x && !this.lastTransform.y && !this.isZooming) {
      this.initialContentRect = this.content.media.getBoundingClientRect();
    }
  };

  protected onSwipeReset = (e?: Event) => {
    // move
    this.moversContainer.classList.remove('no-transition');
    this.zoomElements.rangeSelector.container.classList.add('with-transition');
    this.clampZoomDebounced.clearTimeout();

    if(e?.type === 'mouseup' && this.draggingType === 'mousemove') {
      this.ignoreNextClick = true;
    }

    const {draggingType} = this;
    this.isZoomingNow = false;
    this.isGesturingNow = false;
    this.draggingType = undefined;

    if(this.closing) {
      return;
    }

    if(this.transform.scale > ZOOM_INITIAL_VALUE) {
      // Get current content boundaries
      const s1 = Math.min(this.transform.scale, ZOOM_MAX_VALUE);
      const scaleFactor = s1 / this.transform.scale;

      // Calculate new position based on the last zoom center to keep the zoom center
      // at the same position when bouncing back from max zoom
      let x1 = this.transform.x * scaleFactor + (this.lastZoomCenter.x - scaleFactor * this.lastZoomCenter.x);
      let y1 = this.transform.y * scaleFactor + (this.lastZoomCenter.y - scaleFactor * this.lastZoomCenter.y);

      // If scale didn't change, we need to add inertia to pan gesture
      if(draggingType && draggingType !== 'wheel' && this.lastTransform.scale === this.transform.scale) {
        // Arbitrary pan velocity coefficient
        const k = 0.1;

        // Calculate user gesture velocity
        const elapsedTime = Math.max(1, Date.now() - this.lastGestureTime);
        const Vx = Math.abs(this.lastDragOffset.x) / elapsedTime;
        const Vy = Math.abs(this.lastDragOffset.y) / elapsedTime;

        // Add extra distance based on gesture velocity and last pan delta
        x1 -= Math.abs(this.lastDragOffset.x) * Vx * k * -this.lastDragDelta.x;
        y1 -= Math.abs(this.lastDragOffset.y) * Vy * k * -this.lastDragDelta.y;
      }

      const [transform] = this.calculateOffsetBoundaries({x: x1, y: y1, scale: s1});
      this.lastTransform = transform;
      this.setTransform(transform);
    } else if(this.transform.scale < ZOOM_INITIAL_VALUE) {
      this.resetZoom();
    }
  };

  protected onZoom = ({
    initialCenterX,
    initialCenterY,
    zoom,
    zoomAdd,
    currentCenterX,
    currentCenterY,
    dragOffsetX,
    dragOffsetY,
    zoomFactor
  }: ZoomDetails) => {
    initialCenterX ||= windowSize.width / 2;
    initialCenterY ||= windowSize.height / 2;
    currentCenterX ||= windowSize.width / 2;
    currentCenterY ||= windowSize.height / 2;

    this.isZoomingNow = true;

    const zoomMaxBounceValue = ZOOM_MAX_VALUE * 3;
    const scale = zoomAdd !== undefined ? clamp(this.lastTransform.scale + zoomAdd, ZOOM_MIN_VALUE, zoomMaxBounceValue) : (zoom ?? clamp(this.lastTransform.scale * zoomFactor, ZOOM_MIN_VALUE, zoomMaxBounceValue));
    const scaleFactor = scale / this.lastTransform.scale;
    const offsetX = Math.abs(Math.min(this.lastTransform.x, 0));
    const offsetY = Math.abs(Math.min(this.lastTransform.y, 0));

    // Save last zoom center for bounce back effect
    this.lastZoomCenter = {
      x: currentCenterX,
      y: currentCenterY
    };

    // Calculate new center relative to the shifted image
    const scaledCenterX = offsetX + initialCenterX;
    const scaledCenterY = offsetY + initialCenterY;

    const {scaleOffsetX, scaleOffsetY} = this.calculateScaleOffset({x: scaledCenterX, y: scaledCenterY, scale: scaleFactor});

    const [transform] = this.calculateOffsetBoundaries({
      x: this.lastTransform.x + scaleOffsetX + dragOffsetX,
      y: this.lastTransform.y + scaleOffsetY + dragOffsetY,
      scale
    });

    this.setTransform(transform);
  };

  protected changeZoomByPosition(x: number, y: number, scale: number) {
    const {scaleOffsetX, scaleOffsetY} = this.calculateScaleOffset({x, y, scale});
    const transform = this.calculateOffsetBoundaries({
      x: scaleOffsetX,
      y: scaleOffsetY,
      scale
    })[0];

    this.setTransform(transform);
  }

  protected setTransform(transform: Transform) {
    this.transform = transform;
    this.changeZoom(transform.scale);
  }

  // Calculate how much we need to shift the image to keep the zoom center at the same position
  protected calculateScaleOffset({x, y, scale}: {
    x: number,
    y: number,
    scale: number
  }) {
    return {
      scaleOffsetX: x - scale * x,
      scaleOffsetY: y - scale * y
    };
  }

  protected toggleZoom(enable?: boolean) {
    const isVisible = this.isZooming;
    const auto = enable === undefined;
    if(this.zoomElements.rangeSelector.mousedown || this.ctrlKeyDown) {
      enable = true;
    }

    enable ??= !isVisible;

    if(isVisible === enable) {
      return;
    }

    replaceButtonIcon(this.buttons.zoomin, !enable ? 'zoomin' : 'zoomout');
    this.zoomElements.container.classList.toggle('is-visible', this.isZooming = enable);
    this.wholeDiv.classList.toggle('is-zooming', enable);

    if(auto || !enable) {
      const zoomValue = enable ? this.transform.scale : ZOOM_INITIAL_VALUE;
      this.setZoomValue(zoomValue);
      this.zoomElements.rangeSelector.setProgress(zoomValue);
    }

    if(this.videoPlayer) {
      this.videoPlayer.lockControls(enable ? false : undefined);
    }
  }

  protected addZoomStep(add: boolean) {
    this.addZoom(ZOOM_STEP * (add ? 1 : -1));
  }

  protected resetZoom() {
    this.setTransform({
      x: 0,
      y: 0,
      scale: ZOOM_INITIAL_VALUE
    });
  }

  protected changeZoom(value = this.transform.scale) {
    this.transform.scale = value;
    this.zoomElements.rangeSelector.setProgress(value);
    this.setZoomValue(value);
  }

  protected addZoom(value: number) {
    this.lastTransform = this.transform;
    this.onZoom({
      zoomAdd: value,
      currentCenterX: 0,
      currentCenterY: 0,
      initialCenterX: 0,
      initialCenterY: 0,
      dragOffsetX: 0,
      dragOffsetY: 0
    });
    this.lastTransform = this.transform;
    this.clampZoomDebounced();
  }

  protected getZoomBounce() {
    return this.isGesturingNow && IS_TOUCH_SUPPORTED ? 50 : 0;
  }

  protected calculateOffsetBoundaries = (
    {x, y, scale}: Transform,
    offsetTop = 0
  ): [Transform, boolean, boolean] => {
    if(!this.initialContentRect) return [{x, y, scale}, true, true];
    // Get current content boundaries
    let inBoundsX = true;
    let inBoundsY = true;

    const {minX, maxX, minY, maxY} = this.getZoomBoundaries(scale, offsetTop);

    inBoundsX = isBetween(x, maxX, minX);
    x = clamp(x, maxX, minX);

    inBoundsY = isBetween(y, maxY, minY);
    y = clamp(y, maxY, minY);

    return [{x, y, scale}, inBoundsX, inBoundsY];
  };

  protected getZoomBoundaries(scale = this.transform.scale, offsetTop = 0) {
    if(!this.initialContentRect) {
      return {minX: 0, maxX: 0, minY: 0, maxY: 0};
    }

    const centerX = (windowSize.width - windowSize.width * scale) / 2;
    const centerY = (windowSize.height - windowSize.height * scale) / 2;

    // If content is outside window we calculate offset boundaries
    // based on initial content rect and current scale
    const minX = Math.max(-this.initialContentRect.left * scale, centerX);
    const maxX = windowSize.width - this.initialContentRect.right * scale;

    const minY = Math.max(-this.initialContentRect.top * scale + offsetTop, centerY);
    const maxY = windowSize.height - this.initialContentRect.bottom * scale;

    return {minX, maxX, minY, maxY};
  }

  protected setZoomValue = (value = this.transform.scale) => {
    this.initialContentRect ??= this.content.media.getBoundingClientRect();

    // this.zoomValue = value;
    if(value === ZOOM_INITIAL_VALUE) {
      this.transform.x = 0;
      this.transform.y = 0;
    }

    this.moversContainer.style.transform = `translate3d(${this.transform.x.toFixed(3)}px, ${this.transform.y.toFixed(3)}px, 0px) scale(${value.toFixed(3)})`;

    this.zoomElements.btnOut.classList.toggle('inactive', value <= ZOOM_MIN_VALUE);
    this.zoomElements.btnIn.classList.toggle('inactive', value >= ZOOM_MAX_VALUE);

    this.toggleZoom(value !== ZOOM_INITIAL_VALUE);
  };

  protected setBtnMenuToggle(buttons: ButtonMenuItemOptions[]) {
    const btnMenuToggle = ButtonMenuToggle({buttonOptions: {onlyMobile: true}, direction: 'bottom-left', buttons});
    this.topbar.append(btnMenuToggle);
  }

  public close(discard?: boolean) {
    if(this.setMoverAnimationPromise) return Promise.reject();

    this.closing = true;
    this.swipeHandler?.removeListeners();

    if(this.navigationItem) {
      appNavigationController.removeItem(this.navigationItem);
    }

    this.author.avatarMiddlewareHelper?.destroy();

    const promise = this.setMoverToTarget(this.target?.element, true).then(({onAnimationEnd}) => onAnimationEnd);

    this.setMoverPromise = null;
    this.tempId = -1;
    if((window as any).appMediaViewer === this) {
      (window as any).appMediaViewer = undefined;
    }

    /* if(appSidebarRight.historyTabIDs.slice(-1)[0] === AppSidebarRight.SLIDERITEMSIDS.forward) {
      promise.then(() => {
        appSidebarRight.forwardTab.closeBtn.click();
      });
    } */

    this.removeGlobalListeners();

    promise.finally(() => {
      this.wholeDiv.remove();
      this.toggleOverlay(false);
      this.middlewareHelper.destroy();
    });

    this.listenerSetter.removeAll();

    this.hangUp(discard);

    return promise;
  }

  protected toggleOverlay(active: boolean) {
    overlayCounter.isDarkOverlayActive = active;
    animationIntersector.checkAnimations2(active);
  }

  protected toggleGlobalListeners(active: boolean) {
    if(active) this.setGlobalListeners();
    else this.removeGlobalListeners();
  }

  protected removeGlobalListeners() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  protected setGlobalListeners() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  onClick = (e: MouseEvent) => {
    if(this.ignoreNextClick) {
      this.ignoreNextClick = undefined;
      return;
    }

    if(this.setMoverAnimationPromise) return;

    const target = e.target as HTMLElement;
    if(target.tagName === 'A') return;
    cancelEvent(e);

    if(IS_TOUCH_SUPPORTED) {
      if(this.highlightSwitchersTimeout) {
        clearTimeout(this.highlightSwitchersTimeout);
      } else {
        this.wholeDiv.classList.add('highlight-switchers');
      }

      this.highlightSwitchersTimeout = window.setTimeout(() => {
        this.wholeDiv.classList.remove('highlight-switchers');
        this.highlightSwitchersTimeout = 0;
      }, 3e3);

      return;
    }

    if(hasMouseMovedSinceDown(e)) {
      return;
    }

    const isZooming = this.isZooming && false;
    let mover: HTMLElement = null;
    const classNames = ['ckin__player', 'media-viewer-buttons', 'media-viewer-author', 'media-viewer-caption', 'zoom-container'];
    if(isZooming) {
      classNames.push('media-viewer-movers');
    }

    classNames.find((s) => {
      try {
        mover = findUpClassName(target, s);
        if(mover) return true;
      } catch(err) {return false;}
    });

    if(/* target === this.mediaViewerDiv */!mover || (!isZooming && (target.tagName === 'IMG' || target.tagName === 'image'))) {
      this.onLeaveClick();
    }
  };

  private onKeyDown = (e: KeyboardEvent) => {
    // this.log('onKeyDown', e);
    if(overlayCounter.overlaysActive > 1) {
      return;
    }

    const key = e.key;

    let good = true;
    if(key === 'ArrowLeft' || key === 'ArrowRight') {
      good = true;
    } else if(key === '-' || key === '=') {
      if(this.ctrlKeyDown) {
        this.addZoomStep(key === '=');
      }
    } else {
      good = false;
    }

    if(e.ctrlKey || e.metaKey) {
      this.ctrlKeyDown = true;
    }

    if(good) {
      cancelEvent(e);
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if(overlayCounter.overlaysActive > 1) {
      return;
    }

    if(!(e.ctrlKey || e.metaKey)) {
      this.ctrlKeyDown = false;

      if(this.isZooming) {
        this.setZoomValue();
      }
    }
  };

  protected async setMoverToTarget(target: HTMLElement, closing = false) {
    const mover = this.content.mover;

    if(!closing) {
      mover.replaceChildren();
      // mover.append(this.buttons.prev, this.buttons.next);
    }

    const zoomValue = this.isZooming && closing /* && false */ ? this.transform.scale : ZOOM_INITIAL_VALUE;
    /* if(!(zoomValue > 1 && closing)) */ this.removeCenterFromMover(mover);

    const delay = liteMode.isAvailable('animations') ? (200) : 0;

    let realParent: HTMLElement;

    let rect: DOMRect;
    if(target) {
      if(findUpAvatar(target) || target.classList.contains('grid-item')/*  || target.classList.contains('document-ico') */) {
        realParent = target;
        rect = target.getBoundingClientRect();
      } else if(target.classList.contains('profile-avatars-avatar')) {
        realParent = findUpClassName(target, 'profile-avatars-container');
        rect = realParent.getBoundingClientRect();

        // * if not active avatar
        if(closing && target.getBoundingClientRect().left !== rect.left) {
          target = realParent = rect = undefined;
        }
      }
    }

    if(!target) {
      target = this.content.media;
    }

    if(!rect) {
      realParent = target.parentElement as HTMLElement;
      rect = target.getBoundingClientRect();
    }

    let needOpacity = false;
    if(target !== this.content.media && !target.classList.contains('profile-avatars-avatar')) {
      const overflowElement = findUpClassName(realParent, 'scrollable');
      const visibleRect = getVisibleRect(realParent, overflowElement, true);

      if(closing && (!visibleRect || visibleRect.overflow.vertical === 2 || visibleRect.overflow.horizontal === 2)) {
        target = this.content.media;
        realParent = target.parentElement as HTMLElement;
        rect = target.getBoundingClientRect();
      } else if(visibleRect && (visibleRect.overflow.vertical === 1 || visibleRect.overflow.horizontal === 1)) {
        needOpacity = true;
      }
    }

    const containerRect = this.content.media.getBoundingClientRect();

    let transform = '';
    const left = rect.left;
    const top = rect.top;

    transform += `translate3d(${left}px,${top}px,0) `;

    let aspecter: HTMLDivElement;
    if(target instanceof HTMLImageElement || target instanceof HTMLVideoElement || target.tagName === 'DIV') {
      if(mover.firstElementChild && mover.firstElementChild.classList.contains('media-viewer-aspecter')) {
        aspecter = mover.firstElementChild as HTMLDivElement;

        const player = aspecter.querySelector('.ckin__player');
        if(player) {
          const video = player.firstElementChild as HTMLVideoElement;
          aspecter.append(video);
          player.remove();
        }

        if(!aspecter.style.cssText) { // всё из-за видео, элементы управления скейлятся, так бы можно было этого не делать
          mover.classList.remove('active');
          this.setFullAspect(aspecter, containerRect, rect);
          void mover.offsetLeft; // reflow
          mover.classList.add('active');
        }
      } else {
        aspecter = document.createElement('div');
        aspecter.classList.add('media-viewer-aspecter');
        mover.prepend(aspecter);
      }

      aspecter.style.cssText = `width: ${rect.width}px; height: ${rect.height}px; transform: scale3d(${containerRect.width / rect.width}, ${containerRect.height / rect.height}, 1);`;
    }

    mover.style.width = containerRect.width + 'px';
    mover.style.height = containerRect.height + 'px';

    // const scaleX = rect.width / (containerRect.width * zoomValue);
    // const scaleY = rect.height / (containerRect.height * zoomValue);
    const scaleX = rect.width / containerRect.width;
    const scaleY = rect.height / containerRect.height;
    transform += `scale3d(${scaleX},${scaleY},1) `;

    let borderRadius = window.getComputedStyle(realParent).getPropertyValue('border-radius');
    const brSplitted = fillPropertyValue(borderRadius) as string[];
    borderRadius = brSplitted.map((r) => (parseInt(r) / scaleX) + 'px').join(' ');
    mover.style.borderRadius = borderRadius;

    // let borderRadius = '0px 0px 0px 0px';

    if(closing && zoomValue !== 1) {
      const left = rect.left - (windowSize.width * scaleX - rect.width) / 2;
      const top = rect.top - (windowSize.height * scaleY - rect.height) / 2;
      this.moversContainer.style.transform = `matrix(${scaleX}, 0, 0, ${scaleY}, ${left}, ${top})`;
    } else {
      mover.style.transform = transform;
    }

    needOpacity && (mover.style.opacity = '0'/* !closing ? '0' : '' */);

    let path: SVGPathElement;
    const isOut = target.classList.contains('is-out');

    const deferred = this.setMoverAnimationPromise = deferredPromise<void>();
    const ret = {onAnimationEnd: deferred};

    const timeout = setTimeout(() => {
      if(!deferred.isFulfilled && !deferred.isRejected) {
        deferred.resolve();
      }
    }, 1000);

    deferred.finally(() => {
      if(this.setMoverAnimationPromise === deferred) {
        this.setMoverAnimationPromise = null;
      }

      clearTimeout(timeout);
    });

    if(!closing) {
      let mediaElement: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;
      let src: string;

      // if(target instanceof HTMLVideoElement) {
      const selector = 'video, img, .canvas-thumbnail';
      const queryFrom = target.matches(selector) ? target.parentElement : target;
      const elements = Array.from(queryFrom.querySelectorAll(selector)) as HTMLImageElement[];
      if(elements.length) {
        target = elements.pop();
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if(target instanceof HTMLImageElement) {
          canvas.width = target.naturalWidth;
          canvas.height = target.naturalHeight;
        } else if(target instanceof HTMLVideoElement) {
          canvas.width = target.videoWidth;
          canvas.height = target.videoHeight;
        } else if(target instanceof HTMLCanvasElement) {
          canvas.width = target.width;
          canvas.height = target.height;
        }

        canvas.className = 'canvas-thumbnail thumbnail media-photo';
        context.drawImage(target as HTMLImageElement | HTMLCanvasElement, 0, 0);
        target = canvas;
      }
      // }

      if(target.tagName === 'DIV' || findUpAvatar(target)) { // useContainerAsTarget
        const images = Array.from(target.querySelectorAll('img')) as HTMLImageElement[];
        const image = images.pop();
        if(image) {
          mediaElement = new Image();
          src = image.src;
          mover.append(mediaElement);
        }
        /* mediaElement = new Image();
        src = target.style.backgroundImage.slice(5, -2); */
      } else if(target instanceof HTMLImageElement) {
        mediaElement = new Image();
        src = target.src;
      } else if(target instanceof HTMLVideoElement) {
        mediaElement = createVideo({middleware: mover.middlewareHelper.get()});
        mediaElement.src = target.src;
      } else if(target instanceof HTMLCanvasElement) {
        mediaElement = target;
      }

      if(aspecter) {
        aspecter.style.borderRadius = borderRadius;

        const thumbDiv = document.createElement('div');
        thumbDiv.classList.add('media-viewer-stream-thumb');
        aspecter.append(thumbDiv);

        if(mediaElement) {
          aspecter.append(mediaElement);
        }
      }

      mediaElement = mover.querySelector('video, img');
      if(mediaElement instanceof HTMLImageElement) {
        mediaElement.classList.add('thumbnail');
        if(!aspecter) {
          mediaElement.style.width = containerRect.width + 'px';
          mediaElement.style.height = containerRect.height + 'px';
        }

        if(src) {
          await renderImageFromUrlPromise(mediaElement, src);
        }
      }/*  else if(mediaElement instanceof HTMLVideoElement && mediaElement.firstElementChild && ((mediaElement.firstElementChild as HTMLSourceElement).src || src)) {
        await new Promise((resolve, reject) => {
          mediaElement.addEventListener('loadeddata', resolve);

          if(src) {
            (mediaElement.firstElementChild as HTMLSourceElement).src = src;
          }
        });
      } */

      mover.style.display = '';

      fastRaf(() => {
        mover.classList.add('active');
      });
    } else {
      /* if(mover.classList.contains('center')) {
        mover.classList.remove('center');
        void mover.offsetLeft; // reflow
      } */

      if(target.classList.contains('media-viewer-media')) {
        mover.classList.add('hiding');
      }

      this.toggleWholeActive(false);

      // return ret;

      setTimeout(() => {
        mover.style.borderRadius = borderRadius;

        if(mover.firstElementChild) {
          (mover.firstElementChild as HTMLElement).style.borderRadius = borderRadius;
        }
      }, delay / 2);

      setTimeout(() => {
        mover.replaceChildren();
        mover.classList.remove('moving', 'active', 'hiding');
        mover.style.cssText = 'display: none;';

        deferred.resolve();
      }, delay);

      mover.classList.remove('opening');

      return ret;
    }

    mover.classList.add('opening');

    // await new Promise((resolve) => setTimeout(resolve, 0));
    // await new Promise((resolve) => window.requestAnimationFrame(resolve));
    // * одного RAF'а недостаточно, иногда анимация с одним не срабатывает (преимущественно на мобильных)
    await doubleRaf();

    // чтобы проверить установленную позицию - раскомментировать
    // throw '';

    // await new Promise((resolve) => setTimeout(resolve, 5e3));

    mover.style.transform = `translate3d(${containerRect.left}px,${containerRect.top}px,0) scale3d(1,1,1)`;
    // mover.style.transform = `translate(-50%,-50%) scale(1,1)`;
    needOpacity && (mover.style.opacity = ''/* closing ? '0' : '' */);

    if(aspecter) {
      this.setFullAspect(aspecter, containerRect, rect);
    }

    // throw '';

    setTimeout(() => {
      mover.style.borderRadius = '';

      if(mover.firstElementChild) {
        (mover.firstElementChild as HTMLElement).style.borderRadius = '';
      }
    }, 0/* delay / 2 */);

    mover.dataset.timeout = '' + setTimeout(() => {
      mover.classList.remove('moving', 'opening');

      if(aspecter) { // всё из-за видео, элементы управления скейлятся, так бы можно было этого не делать
        if(mover.querySelector('video') || true) {
          mover.classList.remove('active');
          aspecter.style.cssText = '';
          void mover.offsetLeft; // reflow
        }

        // aspecter.classList.remove('disable-hover');
      }

      // эти строки нужны для установки центральной позиции, в случае ресайза это будет нужно
      mover.classList.add('center', 'no-transition');
      /* mover.style.left = mover.style.top = '50%';
      mover.style.transform = 'translate(-50%, -50%)';
      void mover.offsetLeft; // reflow */

      // это уже нужно для будущих анимаций
      mover.classList.add('active');
      delete mover.dataset.timeout;

      deferred.resolve();
    }, delay);

    if(path) {
      this.sizeTailPath(path, containerRect, scaleX, delay, true, isOut, borderRadius);
    }

    return ret;
  }

  public toggleWholeActive(active: boolean) {
    if(active) {
      this.wholeDiv.classList.add('active');
    } else {
      this.wholeDiv.classList.add('backwards');
      setTimeout(() => {
        this.wholeDiv.classList.remove('active');
      }, 0);
    }
  }

  protected setFullAspect(aspecter: HTMLDivElement, containerRect: DOMRect, rect: DOMRect) {
    /* let media = aspecter.firstElementChild;
    let proportion: number;
    if(media instanceof HTMLImageElement) {
      proportion = media.naturalWidth / media.naturalHeight;
    } else if(media instanceof HTMLVideoElement) {
      proportion = media.videoWidth / media.videoHeight;
    } */
    const proportion = containerRect.width / containerRect.height;

    let {width, height} = rect;
    /* if(proportion === 1) {
      aspecter.style.cssText = '';
    } else { */
    if(proportion > 0) {
      width = height * proportion;
    } else {
      height = width * proportion;
    }

    // this.log('will set style aspecter:', `width: ${width}px; height: ${height}px; transform: scale(${containerRect.width / width}, ${containerRect.height / height});`);

    aspecter.style.cssText = `width: ${width}px; height: ${height}px; transform: scale3d(${containerRect.width / width}, ${containerRect.height / height}, 1);`;
    // }
  }

  protected sizeTailPath(path: SVGPathElement, rect: DOMRect, scaleX: number, delay: number, upscale: boolean, isOut: boolean, borderRadius: string) {
    const start = Date.now();
    const {width, height} = rect;
    delay = delay / 2;

    const br = borderRadius.split(' ').map((v) => parseInt(v));

    const step = () => {
      const diff = Date.now() - start;

      let progress = delay ? diff / delay : 1;
      if(progress > 1) progress = 1;
      if(upscale) progress = 1 - progress;

      const _br: [number, number, number, number] = br.map((v) => v * progress) as any;

      let d: string;
      if(isOut) d = generatePathData(0, 0, width - (9 / scaleX * progress), height, ..._br);
      else d = generatePathData(9 / scaleX * progress, 0, width/* width - (9 / scaleX * progress) */, height, ..._br);
      path.setAttributeNS(null, 'd', d);

      if(diff < delay) fastRaf(step);
    };

    // window.requestAnimationFrame(step);
    step();
  }

  protected removeCenterFromMover(mover: HTMLElement) {
    if(mover.classList.contains('center')) {
      // const rect = mover.getBoundingClientRect();
      const rect = this.content.media.getBoundingClientRect();
      mover.style.transform = `translate3d(${rect.left}px,${rect.top}px,0)`;
      mover.classList.remove('center');
      void mover.offsetLeft; // reflow
      mover.classList.remove('no-transition');
    }
  }

  protected moveTheMover(mover: HTMLElement, toLeft = true) {
    const windowW = windowSize.width;

    this.removeCenterFromMover(mover);

    // mover.classList.remove('active');
    mover.classList.add('moving');

    if(mover.dataset.timeout) { // и это тоже всё из-за скейла видео, так бы это не нужно было
      clearTimeout(+mover.dataset.timeout);
    }

    const rect = mover.getBoundingClientRect();

    const newTransform = mover.style.transform.replace(/translate3d\((.+?),/, (match, p1) => {
      const x = toLeft ? -rect.width : windowW;
      // const x = toLeft ? -(rect.right + (rect.width / 2)) : windowW / 2;

      return match.replace(p1, x + 'px');
    });

    // //////this.log('set newTransform:', newTransform, mover.style.transform, toLeft);
    mover.style.transform = newTransform;

    setTimeout(() => {
      mover.middlewareHelper.destroy();
      mover.remove();
    }, 350);
  }

  protected setNewMover() {
    const newMover = document.createElement('div');
    newMover.classList.add('media-viewer-mover');
    newMover.style.display = 'none';
    newMover.middlewareHelper = this.middlewareHelper.get().create();

    if(this.content.mover) {
      const oldMover = this.content.mover;
      oldMover.parentElement.append(newMover);
    } else {
      this.moversContainer.append(newMover);
    }

    return this.content.mover = newMover;
  }

  protected updateMediaSource(target: HTMLElement, url: string, tagName: 'video' | 'img') {
    const el = target.tagName.toLowerCase() === tagName ? target : target.querySelector(tagName) as HTMLElement;
    if(el && !findUpClassName(target, 'document')) {
      if(findUpClassName(target, 'attachment')) {
        // two parentElements because element can be contained in aspecter
        const preloader = target.parentElement.parentElement.querySelector('.preloader-container') as HTMLElement;
        if(preloader) {
          if(tagName === 'video') {
            if(preloader.classList.contains('manual')) {
              preloader.click();
              // return;
            }

            return;
          }

          preloader.remove();
        }
      }

      if((el as HTMLImageElement).src !== url) {
        renderImageFromUrl(el, url);
      }

      // ! костыль, но он тут даже и не нужен
      if(el.classList.contains('thumbnail') && el.parentElement.classList.contains('media-container-aspecter')) {
        el.classList.remove('thumbnail');
      }
    }
    /* } else {

    } */
  }

  private instance: LiveStreamInstance;

  public async _openMedia({
    instance,
    target,
    mediaTimestamp,
    src
  }: {
    instance: LiveStreamInstance,
    target?: HTMLElement,
    mediaTimestamp?: number,
    src: string
    /* , needLoadMore = true */
  }) {
    if(this.setMoverPromise) return this.setMoverPromise;

    this.instance = instance;

    /* if(DEBUG) {
      this.log('openMedia:', media, fromId, prevTargets, nextTargets);
    } */

    const setAuthorPromise = this.setAuthorInfo(this.instance.chatId.toPeerId(true));
    if(this.isFirstOpen) {
      // this.targetContainer = targetContainer;
      // this.needLoadMore = needLoadMore;
      this.isFirstOpen = false;
      (window as any).appMediaViewer = this;
      // this.loadMore = loadMore;

      /* if(appSidebarRight.historyTabIDs.slice(-1)[0] === AppSidebarRight.SLIDERITEMSIDS.forward) {
        appSidebarRight.forwardTab.closeBtn.click();
        await new Promise((resolve) => setTimeout(resolve, 200));
      } */
    }

    // if(prevTarget && (!prevTarget.parentElement || !this.isElementVisible(this.targetContainer, prevTarget))) prevTarget = null;
    // if(nextTarget && (!nextTarget.parentElement || !this.isElementVisible(this.targetContainer, nextTarget))) nextTarget = null;

    const container = this.content.media;
    const useContainerAsTarget = !target || target === container;
    if(useContainerAsTarget) target = container;

    this.target = {element: target} as any;
    const tempId = ++this.tempId;

    if(container.firstElementChild) {
      container.replaceChildren();
    }

    // ok set

    this.navigationItem = {
      type: 'media',
      onPop: (canAnimate) => {
        if(this.setMoverAnimationPromise) {
          return false;
        }

        if(!canAnimate && IS_MOBILE_SAFARI) {
          this.wholeDiv.remove();
        }

        this.onLeaveClick();
      }
    };

    appNavigationController.pushItem(this.navigationItem);

    this.toggleOverlay(true);
    this.setGlobalListeners();
    await setAuthorPromise;

    if(!this.wholeDiv.parentElement) {
      this.pageEl.insertBefore(this.wholeDiv, document.getElementById('main-columns'));
      void this.wholeDiv.offsetLeft; // reflow
    }

    this.toggleWholeActive(true);

    const mover = this.content.mover;

    const maxWidth = windowSize.width;
    // const maxWidth = this.pageEl.scrollWidth;
    // TODO: const maxHeight = mediaSizes.isMobile ? appPhotosManager.windowH : appPhotosManager.windowH - 100;
    let padding = 0;
    const windowH = windowSize.height;
    if(windowH < 1000000 && !mediaSizes.isMobile) {
      padding = 120;
    }
    const maxHeight = windowH - 120 - padding;

    const sizeS = setAttachmentSize({
      element: container,
      boxWidth: maxWidth,
      boxHeight: maxHeight,
      noZoom: mediaSizes.isMobile ? false : true,
      size: makeMediaSize(1920, 1080)
    });

    console.log('mediaSize', sizeS);


    // need after setAttachmentSize
    /* if(useContainerAsTarget) {
      target = target.querySelector('img, video') || target;
    } */

    // //////this.log('will wrap video', media, size);

    const middleware = mover.middlewareHelper.get();
    const video = createVideo({pip: true, middleware});
    video.src = src;

    if(this.wholeDiv.classList.contains('no-forwards')) {
      video.addEventListener('contextmenu', cancelEvent);
    }

    return this.setMoverPromise = this.setMoverToTarget(target, false).then(({onAnimationEnd}) => {
      const div = mover.firstElementChild && mover.firstElementChild.classList.contains('media-viewer-aspecter') ? mover.firstElementChild : mover;

      const moverVideo = mover.querySelector('video');
      if(moverVideo) {
        moverVideo.remove();
      }

      // video.src = '';

      video.setAttribute('playsinline', 'true');

      // * fix for playing video if viewer is closed (https://contest.com/javascript-web-bonus/entry1425#issue11629)
      video.addEventListener('timeupdate', () => {
        if(this.tempId !== tempId) {
          video.pause();
        }
      });
      /*
      this.addEventListener('setMoverAfter', () => {
        video.src = '';
        video.load();
      }, {once: true});
*/
      video.autoplay = true;

      if(mediaTimestamp !== undefined) {
        setCurrentTime(video, mediaTimestamp);
      }

      // if(!video.parentElement) {
      div.append(video);
      // }

      if(this.isChannelOwner()) {
        this.buildOopsContainer();
        this.content.mover.append(this.oopsContainer);
      }
      this.listenerSetter.add(this.instance)('state', this.streamStateChanged.bind(this));

      onAnimationEnd.then(() => {
        if(video.readyState < video.HAVE_FUTURE_DATA) {
          // console.log('ppp 1');
          this.videoAvailabilityChanged(false);
        }
      });

      const attachCanPlay = () => {
        video.addEventListener('canplay', () => {
          this.videoAvailabilityChanged(true);
          video.parentElement.classList.remove('is-buffering');
        }, {once: true});
      };

      video.addEventListener('waiting', () => {
        const loading = video.networkState === video.NETWORK_LOADING;
        const isntEnoughData = video.readyState < video.HAVE_FUTURE_DATA;

        // this.log('video waiting for progress', loading, isntEnoughData);
        if(loading && isntEnoughData) {
          attachCanPlay();

          // console.log('ppp 3');
          this.videoAvailabilityChanged(false);

          // поставлю класс для плеера, чтобы убрать большую иконку пока прелоадер на месте
          video.parentElement.classList.add('is-buffering');
        }
      });

      if(this.wholeDiv.classList.contains('no-forwards')) {
        video.addEventListener('contextmenu', (e) => {
          cancelEvent(e);
        });
      }

      attachCanPlay();

      this.releaseSingleMedia = appMediaPlaybackController.setSingleMedia(video);

      video.dataset.ckin = 'default';
      video.dataset.overlay = '1';

      Promise.all([onAnimationEnd]).then(() => {
        if(this.tempId !== tempId) {
          return;
        }

        const play = true;
        const player = this.videoPlayer = new StreamPlayer({
          video, play, managers: this.managers,
          onPip: (pip) => {
            const otherMediaViewer = (window as any).appMediaViewer;
            if(!pip && otherMediaViewer && otherMediaViewer !== this) {
              this.releaseSingleMedia = undefined;
              this.close();
              return;
            }

            const mover = this.moversContainer.lastElementChild as HTMLElement;
            mover.classList.toggle('hiding', pip);
            this.toggleWholeActive(!pip);
            this.toggleOverlay(!pip);
            this.toggleGlobalListeners(!pip);

            if(this.navigationItem) {
              if(pip) appNavigationController.removeItem(this.navigationItem);
              else appNavigationController.pushItem(this.navigationItem);
            }

            if(pip) {
              // appMediaPlaybackController.toggleSwitchers(true);

              this.releaseSingleMedia(false);
              this.releaseSingleMedia = undefined;

              appMediaPlaybackController.setPictureInPicture(video);
            } else {
              this.releaseSingleMedia = appMediaPlaybackController.setSingleMedia(video);
            }
          },
          onPipClose: () => {
            this.close();
          },
          onClose: () => {
            this.onLeaveClick()
          }
        });
        player.addEventListener('toggleControls', (show) => {
          this.wholeDiv.classList.toggle('has-video-controls', show);
        });

        if(this.isZooming) {
          this.videoPlayer.lockControls(false);
        }

        /* div.append(video);
        mover.append(player.wrapper); */
      });
    }).catch(() => {
      this.setMoverAnimationPromise = null;
    }).finally(() => {
      this.setMoverPromise = null;
    });
  }


  /* * */

  private videoAvailability: boolean;
  private oopsContainerVisible: boolean;

  private videoAvailabilityChanged(availability: boolean) {
    if(this.videoAvailability !== availability) {
      this.videoAvailability = availability;
      this.updateState();
    }
  }

  private streamStateChanged(state: LIVE_STREAM_STATE) {
    if(state === LIVE_STREAM_STATE.CLOSED) {
      if(!this.closing) {
        toast(i18n('LiveStream.ConnectionFailed'));
        this.close(false);
      }
    }
    this.updateState();
  }

  private updateState() {
    if(!this.videoAvailability && this.instance.state !== LIVE_STREAM_STATE.NO_STREAM) {
      if(this.preloader.detached) {
        this.preloader.attach(this.content.mover, true);
      }
    } else if(!this.preloader.detached) {
      this.preloader.detach();
    }

    if(this.isChannelOwner()) {
      if(this.instance.state === LIVE_STREAM_STATE.NO_STREAM) {
        if(!this.oopsContainerVisible) {
          this.oopsContainerVisible = true;
          this.oopsContainer.classList.remove('no-display');
        }
      } else if(this.oopsContainerVisible) {
        this.oopsContainerVisible = false;
        this.oopsContainer.classList.add('no-display');
      }
    }
  }

  private setAuthorInfo(fromId: PeerId | string) {
    const isPeerId = fromId.isPeerId();
    let wrapTitlePromise: Promise<HTMLElement> | HTMLElement;
    if(isPeerId) {
      wrapTitlePromise = wrapPeerTitle({
        peerId: fromId as PeerId,
        dialog: false,
        onlyFirstName: false,
        plainText: false
      })
    } else {
      const title = wrapTitlePromise = document.createElement('span');
      title.append(wrapEmojiText(fromId));
      title.classList.add('peer-title');
    }

    const oldAvatar = this.author.avatarEl;
    const oldAvatarMiddlewareHelper = this.author.avatarMiddlewareHelper;
    const newAvatar = this.author.avatarEl = avatarNew({
      middleware: (this.author.avatarMiddlewareHelper = this.middlewareHelper.get().create()).get(),
      size: 44,
      peerId: fromId as PeerId || NULL_PEER_ID,
      peerTitle: isPeerId ? undefined : '' + fromId
    });

    newAvatar.node.classList.add(MEDIA_VIEWER_CLASSNAME + '-userpic');

    return Promise.all([
      newAvatar.readyThumbPromise,
      wrapTitlePromise
    ]).then(([_, title]) => {
      replaceContent(this.author.date, 'streaming');
      replaceContent(this.author.nameEl, title);

      if(oldAvatar?.node && oldAvatar.node.parentElement) {
        oldAvatar.node.replaceWith(this.author.avatarEl.node);
      } else {
        this.author.container.prepend(this.author.avatarEl.node);
      }

      if(oldAvatar) {
        oldAvatar.node.remove();
        oldAvatarMiddlewareHelper.destroy();
      }
    });
  }

  private async hangUp(discard: boolean) {
    return this.instance?.stopStream(discard);
  }

  private async onLeaveClick(e?: MouseEvent) {
    if(e) {
      cancelEvent(e);
    }
    const chat = apiManagerProxy.getChat(this.instance.chatId);
    if(hasRights(chat, 'manage_call')) {
      PopupElement.createPopup(PopupPeer, 'popup-end-video-chat', {
        titleLangKey: 'LiveStream.End.Title',
        descriptionLangKey: 'LiveStream.End.Text',
        checkboxes: [{
          text: 'LiveStream.End.Third'
        }],
        buttons: [{
          langKey: 'LiveStream.End.OK',
          callback: (e, checkboxes) => {
            this.close(!!checkboxes.size);
          },
          isDanger: true
        }]
      }).show();
    } else {
      this.close();
    }
  };


  /* * */

  public static openStream(instance: LiveStreamInstance) {
    if((window as any).appMediaViewer) {
      return false;
    }

    const mediaSource = new MediaSource();
    new AppStreamViewer()._openMedia({
      src: URL.createObjectURL(mediaSource), instance
    });

    mediaSource.addEventListener('sourceopen', async(e) => {
      let videoSourceBuffer: any, audioSourceBuffer: any;

      let isFirsts = true;
      let timestamp = 0;
      instance.addEventListener('chunk', (chunk) => {
        const videoTrack = chunk.getVideoTrack();
        const audioTrack = chunk.getAudioTrack();
        if(!videoTrack || !audioTrack) {
          return;
        }

        if(isFirsts) {
          videoSourceBuffer = SourceBufferSink({mediaSource});
          videoSourceBuffer.initializeForFirstUse(null, {codec: videoTrack.codec});
          audioSourceBuffer = SourceBufferSink({mediaSource});
          audioSourceBuffer.initializeForFirstUse(null, {codec: audioTrack.codec});
          isFirsts = false;
        }

        videoSourceBuffer.updateTimestampOffset(timestamp / 1000);
        videoSourceBuffer.append({bytes: videoTrack.buffer});
        audioSourceBuffer.updateTimestampOffset(timestamp / 1000);
        audioSourceBuffer.append({bytes: audioTrack.buffer});
        timestamp += chunk.duration;
      });
    });

    return true;
  }

  private isChannelOwner() {
    const chat = apiManagerProxy.getChat(this.instance.chatId);
    return chat._ === 'channel' && chat.pFlags.creator;
  }
}
