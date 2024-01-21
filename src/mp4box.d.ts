declare module 'mp4box' {
  export type Mp4Box_info = {
    hasMoov: boolean
    duration: number
    timescale: number
    isFragmented: boolean
    isProgressive: boolean
    hasIOD: boolean
    brands: string[]
    created: string
    modified: string
    tracks: (Mp4Box_infoAudioTrack | Mp4Box_infoVideoTrack)[]
    audioTracks: Mp4Box_infoAudioTrack[]
    videoTracks: Mp4Box_infoVideoTrack[]
    subtitleTracks: any[]
    metadataTracks: any[]
    hintTracks: any[]
    otherTracks: any[]
    mime: string
  }

  export function createFile(): any;

  type Matrix = {}

  type Kind = {
    schemeURI: string
    value: string
  }

  type Video = {
    width: number
    height: number
  }

  type Audio = {
    sample_rate: number
    channel_count: number
    sample_size: number
  }

  export type Mp4Box_infoTrack = {
    id: number
    name: string
    references: any[]
    edits: any
    created: string
    modified: string
    movie_duration: number
    movie_timescale: number
    layer: number
    alternate_group: number
    volume: number
    matrix: Matrix
    track_width: number
    track_height: number
    timescale: number
    duration: number
    samples_duration: number
    codec: string
    kind: Kind
    language: string
    nb_samples: number
    size: number
    bitrate: number
    type: string
  };

  export type Mp4Box_infoAudioTrack = Mp4Box_infoTrack & { audio: Audio }
  export type Mp4Box_infoVideoTrack = Mp4Box_infoTrack & { video: Video }
}
