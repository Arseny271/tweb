import PopupElement from './index';
import {render} from 'solid-js/web';
import {i18n} from '../../lib/langPack';
import Section, {SectionCaption} from '../section';
import Row from '../row';
import CheckboxField from '../checkboxField';
import InputField from '../inputField';

import audioIcon from '../../images/audio.svg'
import videoVertical from '../../images/vertical.svg'
import videoHorizontal from '../../images/horizontal.svg'
import videoVerticalSelected from '../../images/vertical-selected.svg'
import videoHorizontalSelected from '../../images/horizontal-selected.svg'
import {attachClickEvent} from '../../helpers/dom/clickEvent';
import appImManager from '../../lib/appManagers/appImManager';
import {GroupCall} from '../../layer';
import getRichValueWithCaret from '../../helpers/dom/getRichValueWithCaret';
import toggleDisability from '../../helpers/dom/toggleDisability';
import {toast} from '../toast';

type VideoRecordStyle = 'vertical' | 'horizontal';
type StreamRecordType = 'audio' | 'video';

const MAX_LENGTH_TITLE = 50;

export default class PopupLiveStreamStartRecord extends PopupElement {
  private recordVideoCheckboxField: CheckboxField;
  private recordVideoContainerRow: Row;
  private recordTitleInputField: InputField;
  private currentGroupCall: GroupCall;

  private audioSection: HTMLDivElement;
  private videoSection: HTMLDivElement;
  private videoHorizontalImg: HTMLImageElement;
  private videoVerticalImg: HTMLImageElement;

  private streamRecordType: StreamRecordType = 'audio';
  private videoRecordStyle: VideoRecordStyle = 'horizontal';

  constructor() {
    super('popup-livestream-start-with popup-livestream-start-record', {
      closable: true,
      overlayClosable: true,
      body: true,
      scrollable: true,
      title: 'StreamingRTMP.More.StartRecording',
      footer: true,
      withConfirm: true
    });

    // this.element.classList.remove('night');
    this.construct();
  }

  private _construct() {
    this.btnConfirm.append(i18n('StreamingRTMP.More.StartRecording'));
    this.footer.append(this.btnConfirm);
    this.footer.classList.add('abitlarger');
    this.body.after(this.footer);

    this.recordVideoCheckboxField = new CheckboxField({toggle: true});

    this.recordVideoContainerRow = new Row({
      icon: 'videocamera',
      titleLangKey: 'StreamingRTMP.AlsoRecordVideo',
      listenerSetter: this.listenerSetter,
      checkboxField: this.recordVideoCheckboxField
    })

    this.recordTitleInputField = new InputField({
      label: 'StreamingRTMP.RecordingTitle',
      name: 'livestream-recording-title',
      maxLength: MAX_LENGTH_TITLE
    });;

    const da = (<>
      <Section ref={this.audioSection} noDelimiter={true} class={'in-shadow-section'}>
        <div class={'record-type-icons'}>
          <img src={audioIcon}/>
        </div>
        <SectionCaption caption={'StreamingRTMP.Caption.Record.Audio'}></SectionCaption>
      </Section>
    </>);
    const dv = (<>
      <Section ref={this.videoSection} noDelimiter={true} class={'in-shadow-section'}>
        <div class={'record-type-icons'}>
          <img ref={this.videoHorizontalImg} src={videoHorizontalSelected}/>
          <img ref={this.videoVerticalImg} src={videoVertical}/>
        </div>
        <SectionCaption caption={'StreamingRTMP.Caption.Record.Video'}></SectionCaption>
      </Section>
    </>);

    const ret = (
      <>
        <Section noDelimiter={true}>
          {this.recordTitleInputField.container}
          <SectionCaption caption={'StreamingRTMP.Caption.Record'}></SectionCaption>
          {this.recordVideoContainerRow.container}
        </Section>
        {this.audioSection}
      </>
    );

    this.listenerSetter.add(this.recordVideoCheckboxField.input)('change', () => {
      this.toggleRecordType(this.recordVideoCheckboxField.checked ? 'video': 'audio');
    });

    this.listenerSetter.add(this.recordTitleInputField.input)('input', () => {
      this.handleChange();
    });

    attachClickEvent(this.videoHorizontalImg, () => {
      this.toggleRecordStyle('horizontal');
    }, {listenerSetter: this.listenerSetter});

    attachClickEvent(this.videoVerticalImg, () => {
      this.toggleRecordStyle('vertical');
    }, {listenerSetter: this.listenerSetter});

    attachClickEvent(this.btnConfirm, async() => {
      const toggle = toggleDisability(this.btnConfirm, true);
      try {
        this.start();
        this.hide();
      } catch(err) {
        toggle();
      }
    }, {listenerSetter: this.listenerSetter});

    this.toggleRecordStyle('horizontal');
    return ret;
  }

  private async start() {
    this.managers.appGroupCallsManager.startGroupCallRecording(this.currentGroupCall.id, this.recordTitleInputField.value, this.streamRecordType === 'video', this.videoRecordStyle === 'vertical')
    .then(() => {
    }, () => {
    });
  }

  private toggleRecordType(type: StreamRecordType) {
    if(this.streamRecordType !== type) {
      this.streamRecordType = type;
      if(type === 'video') {
        this.audioSection.replaceWith(this.videoSection);
      } else if(type === 'audio') {
        this.videoSection.replaceWith(this.audioSection);
      }
    }
  }

  private toggleRecordStyle(style: VideoRecordStyle) {
    if(this.videoRecordStyle !== style) {
      this.videoRecordStyle = style;
      if(style === 'horizontal') {
        this.videoHorizontalImg.src = videoHorizontalSelected;
        this.videoVerticalImg.src = videoVertical;
      } else {0
        this.videoHorizontalImg.src = videoHorizontal;
        this.videoVerticalImg.src = videoVerticalSelected;
      }
    }
  }

  private validate() {
    const {value, entities} = getRichValueWithCaret(this.recordTitleInputField.input, true, false);
    if(value.length > MAX_LENGTH_TITLE) {
      return false;
    }
    return true;
  }

  private handleChange() {
    const valid = this.validate();
    this.btnConfirm.toggleAttribute('disabled', !valid);
  }

  private async construct() {
    this.currentGroupCall = appImManager.getGroupCall();

    const div = document.createElement('div');
    this.scrollable.append(div);
    const dispose = render(() => this._construct(), div);
    this.addEventListener('closeAfterTimeout', dispose);
    this.show();
  }
}

