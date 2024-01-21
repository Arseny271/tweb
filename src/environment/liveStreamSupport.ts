import IS_GROUP_CALL_SUPPORTED from './groupCallSupport';
import {IS_FIREFOX} from './userAgent';

const IS_LIVE_STREAM_SUPPORTED = IS_GROUP_CALL_SUPPORTED || IS_FIREFOX;

export default IS_LIVE_STREAM_SUPPORTED;
