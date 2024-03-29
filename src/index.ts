import { SmartBuffer } from 'smart-buffer'
import { Parser } from 'binary-parser'

// useful references:
// https://docs.microsoft.com/en-us/openspecs/windows_protocols/ms-sstr/6d796f37-b4f0-475f-becd-13f1c86c2d1f
// https://github.com/beardypig/pymp4/blob/77d1d0ee1cbe24db4f997ffa80bd4a9160aa96f0/src/pymp4/parser.py

class MP4CheckType { // box type search helper

	private readonly types: string[] = ['ftyp', 'styp', 'mvhd', 'moov', 'moof', 'mfhd', 'tfdt', 'trun', 'tfhd', 'traf', 'mvex', 'mehd', 'trex', 'trak', 'mdia', 'tkhd', 'mdat', 'free', 'skip', 'mdhd', 'hdlr', 'minf', 'vmhd', 'dinf', 'dref', 'stbl', 'stsd', 'stsz', 'stz2', 'stts', 'stss', 'stsc', 'stco', 'co64', 'smhd', 'sidx', 'saiz', 'saio', 'btrt', 'tenc', 'pssh', 'senc', 'sinf', 'frma', 'schm', 'schi', 'uuid', 'abst', 'asrt', 'afrt']
	private type: string = ''

	add(byte: number) {
		const char = String.fromCharCode(byte)
		if (this.type.length < 4) {
			this.type += char
			return
		}
		this.type = this.type.substring(1) + char
	}

	getType() {
		return this.types.includes(this.type) ? this.type : null
	}

}

function copy(buf: Buffer) {
	const c = Buffer.alloc(buf.length)
	for (let i = 0; i < buf.length; i++) {
		c[i] = buf[i]
	}
	return c
}

/*

	Box parsers

	(just parsing what I need)

*/

const tfhdParser = new Parser()
	.endianess('big')
	.uint32('boxLength')
	.array('longBoxLength', { // optional
		type: 'uint64be',
		length: function () {
			return (this.boxLength == 1) ? 1 : 0
		}
	})
	.string('boxType', {
		length: 4
	})
	.uint8('boxVersion')
	.bit6('reserved1')
	.bit1('defaultBaseIsmoof')
	.bit1('durationIsEmpty')
	.bit10('reserved2')
	.bit1('defaultSampleFlagsPresent')
	.bit1('defaultSampleSizePresent')
	.bit1('defaultSampleDurationPresent')
	.bit1('reserved3')
	.bit1('sampleDescriptionIndexPresent')
	.bit1('baseDataOffsetPresent')
	.uint32('trackId')
	.array('baseDataOffset', { // optional
		type: 'uint64be',
		length: function () {
			return Boolean(this.baseDataOffsetPresent) ? 1 : 0
		}
	})
	.array('sampleDescriptionIndex', { // optional
		type: 'uint32be',
		length: function () {
			return Boolean(this.sampleDescriptionIndexPresent) ? 1 : 0
		}
	})
	.array('defaultSampleDuration', { // optional
		type: 'uint32be',
		length: function () {
			return Boolean(this.defaultSampleDurationPresent) ? 1 : 0
		}
	})
	.array('defaultSampleSize', { // optional
		type: 'uint32be',
		length: function () {
			return Boolean(this.defaultSampleSizePresent) ? 1 : 0
		}
	})

const tfdtParser = new Parser()
	.endianess('big')
	.uint32('boxLength')
	.array('longBoxLength', { // optional
		type: 'uint64be',
		length: function () {
			return (this.boxLength == 1) ? 1 : 0
		}
	})
	.string('boxType', {
		length: 4
	})
	.uint8('boxVersion')
	.bit24('flags')
	.uint64('baseMediaDecodeTime')

const trunParser = new Parser()
	.endianess('big')
	.uint32('boxLength')
	.array('longBoxLength', { // optional
		type: 'uint64be',
		length: function () {
			return (this.boxLength == 1) ? 1 : 0
		}
	})
	.string('boxType', {
		length: 4
	})
	.uint8('boxVersion')
	.bit12('reserved1')
	.bit1('sampleCompositionTimeOffsetPresent')
	.bit1('sampleFlagsPresent')
	.bit1('sampleSizePresent')
	.bit1('sampleDurationPresent')
	.bit5('reserved2')
	.bit1('firstSampleFlagsPresent')
	.bit1('reserved3')
	.bit1('dataOffsetPresent')
	.uint32('sampleCount')
	.array('dataOffset', { // optional
		type: 'uint32be',
		length: function () {
			return Boolean(this.dataOffsetPresent) ? 1 : 0
		}
	})
	.array('firstSampleFlags', { // optional
		type: 'uint32be',
		length: function () {
			return Boolean(this.firstSampleFlagsPresent) ? 1 : 0
		}
	})
	.array('perSampleFields', {
		type: 'uint32be',
		length: function() {
			return this.sampleCount * (this.sampleDurationPresent + this.sampleSizePresent + this.sampleFlagsPresent + this.sampleCompositionTimeOffsetPresent)
		}
	})

function trimToStartOfBox(buffer: Buffer, type: string) {
	const c = new MP4CheckType()
	const b = buffer
	for (let i = 0; i < b.length; i++) {
		c.add(b[i])
		if (c.getType() == type) {
			// boxLength(uint32) [longBoxLength(uint64)] boxType(char[4]) ...
			return (b.readUInt32BE(i - 15) == 1)
				? b.slice(i - 15) // has longBoxLength
				: b.slice(i - 7)
		}
	}
	throw `Failed to find box of type "${type}"`
}

function patchMoof(moof: Buffer, baseMediaDecodeTime: bigint) {
	// [moof [mfhd] [traf [tfhd] [tfdt] [trun]]]
	
	const tfhdBuf = trimToStartOfBox(moof, 'tfhd')
	const tfdtBuf = trimToStartOfBox(moof, 'tfdt')
	const trunBuf = trimToStartOfBox(moof, 'trun')
	
	const tfhd = tfhdParser.parse(tfhdBuf)
	const tfdt = tfdtParser.parse(tfdtBuf)
	const trun = trunParser.parse(trunBuf)

	// https://docs.microsoft.com/en-us/azure/media-services/media-services-specifications-ms-sstr-amendment-hevc#2244-tfxdbox
	// "A client may calculate the duration of a fragment by summing the sample durations listed in the Track Run Box (‘trun’) or multiplying the number of samples times the default sample duration. The baseMediaDecodeTime in ‘tfdt’ plus fragment duration equals the URL time parameter for the next fragment."

	let fragmentDuration = 0n
	if (trun.sampleDurationPresent == 1) {
		const inc = 1 + trun.sampleSizePresent + trun.sampleFlagsPresent + trun.sampleCompositionTimeOffsetPresent
		for (let i = 0; i < trun.perSampleFields.length; i += inc) {
			fragmentDuration += BigInt(trun.perSampleFields[i])
		}
	} else if (tfhd.defaultSampleDurationPresent == 1) {
		fragmentDuration = BigInt(trun.sampleCount) * BigInt(tfhd.defaultSampleDuration[0])
	} else {
		console.error('Failed to calculate fragment duration.')
	}

	const writeOffset =
		(tfdt.boxLength == 1)
		? 20 // has longBoxLength
		: 12

	switch (tfdt.boxVersion) {
		case 0:
			tfdtBuf.writeUInt32BE(Number(baseMediaDecodeTime), writeOffset)
			break
		case 1:
			tfdtBuf.writeBigInt64BE(baseMediaDecodeTime, writeOffset)
			break
	}

	return fragmentDuration
}

// fMP4 looks like this:
// ftyp, moov, moof, mdata, moof, mdata, moof, mdata...

// ftyp & moov = initialize the stream
// moof & mdata = video/audio data (fragment)

// when a new client connects, we must initialize the stream
// by sending them ftyp and then moov (hence we cache it),
// and only then we can send the moof+mdata pairs (moof+mdata=a video/audio segment, aka fragment)
// (moof is metadata, mdata is the actual video and audio data).

// each fragment output by ffmpeg contains "base decode time".
// this value starts at 0 for the first fragment,
// and is incremented for the next fragment by the duration of the previous fragment, and so on.
// as of writing this comment, chrome will only play the stream if the time starts at 0 (works for firefox though).
// for this reason, we maintain a base decode time for every new connected client which starts at 0 and is incremented
// by the duration of the fragment we send to the client (or by "default sample duration", if unavailable).

type BoxCallback = (box: Buffer) => void

class Viewer {
	public inited: boolean
	public baseMediaDecodeTime: bigint
	public callback: BoxCallback

	constructor(callback: BoxCallback) {
		this.inited = false
		this.baseMediaDecodeTime = 0n
		this.callback = callback
	}
}

export default class MP4Stream {

	private ftyp: Buffer | null = null
	private moov: Buffer | null = null
	private pair: Buffer[] = []
	private readonly typeChecker = new MP4CheckType()
	private bytesNeeded: BigInt | number = Infinity
	private bytesReceived = 0
	private accum: SmartBuffer = new SmartBuffer()
	private currentBoxType: string | null = null
	private viewers: Viewer[] = []

	feed(mp4stream: Buffer) { // assumes stream uses flags: frag_keyframe+empty_moov+default_base_moof
		for (let i = 0; i < mp4stream.length; i++) {
			const b = mp4stream[i]
	
			this.accum.writeUInt8(b)
			this.typeChecker.add(b)
			this.bytesReceived++
	
			const boxType = this.typeChecker.getType()
	
			if (boxType != null && this.bytesNeeded == Infinity) { // if Infinity then this is a root box (not a child box)
				
				this.accum.readOffset = 0 // move readOffset to start of box

				this.bytesNeeded = this.accum.readUInt32BE()
				if (this.bytesNeeded == 1) {
					this.bytesNeeded = this.accum.readBigInt64BE()
				}
				this.bytesReceived = 8
				this.currentBoxType = boxType
			}
	
			if (this.bytesReceived == this.bytesNeeded) {
				const box = copy(this.accum.toBuffer())
	
				// console.log(currentBoxType, box.length, bytesNeeded)
	
				if (this.currentBoxType == 'ftyp') {
					this.ftyp = box
				} else if (this.currentBoxType == 'moov') {
					this.moov = box
				} else if (this.currentBoxType == 'moof' || this.currentBoxType == 'mdat') {
					this.pair.push(box)
					if (this.pair.length == 2) { // moof + mdata
						for (const viewer of this.viewers) {
							if (!viewer.inited) {
								viewer.callback(this.ftyp!)
								viewer.callback(this.moov!)
								viewer.inited = true
							}
							const moof = copy(this.pair[0])
							const mdata = copy(this.pair[1])
							viewer.baseMediaDecodeTime += patchMoof(moof, viewer.baseMediaDecodeTime)
							viewer.callback(moof)
							viewer.callback(mdata)
						}
						this.pair = []
					}
				} else {
					console.error('Unexpected box type', this.currentBoxType)
				}
	
				this.bytesNeeded = Infinity
				this.bytesReceived = 0
				this.accum.clear()
			}
	
		}
	}

	addViewer(callback: BoxCallback) {
		const viewer = new Viewer(callback)
		this.viewers.push(viewer)
		if (this.ftyp && this.moov) {
			callback(this.ftyp)
			callback(this.moov)
			viewer.inited = true
		}
	}

	removeViewer(callback: BoxCallback) {
		const idx = this.viewers.findIndex(viewer => viewer.callback == callback)
		if (idx == -1) {
			return false
		}
		this.viewers.splice(idx, 1)
		return true
	}

}
