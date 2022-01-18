# mp4stream

mp4stream transforms H.264 stream into a stream the browser understands.

Originally made for Raspberry Pi which produced H.264 video and I wanted to stream it in the browser.

## Example

```javascript
const fs = require('fs')
const { spawn } = require('child_process')
const WebSocket = require('ws')
const MP4Stream = require('mp4stream').default

const stream = fs.createReadStream('myvideo.h264')

const args = ['-i', 'pipe:', '-vcodec', 'copy', '-acodec', 'copy', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-']
const ffprocess = spawn('ffmpeg', args)

const wss = new WebSocket.Server({ port: 3000 })

const mp4stream = new MP4Stream()

wss.on('connection', (ws) => {

	const callback = (buf) => {
		ws.send(buf)
	}

	mp4stream.addViewer(callback)

	ws.on('close', () => {
		mp4stream.removeViewer(callback)
	})
})

ffprocess.stdout.on('data', (data) => {
	console.log('feed')
	mp4stream.feed(data)
})

stream.pipe(ffprocess.stdin) // feed to ffmpeg
```

```html
<!doctype html>
<html>
<body>
<video id="webcam" preload="none" autoplay muted></video>
<script>
const ms = new MediaSource()
const videoEl = document.getElementById('webcam')
videoEl.src = window.URL.createObjectURL(ms)
const ws = new WebSocket('ws://localhost:3000')
ws.binaryType = 'arraybuffer'
ms.addEventListener('sourceopen', (e) => {
	// baseline: video/mp4; codecs="avc1.42E01E, mp4a.40.2"
	// main: video/mp4; codecs="avc1.4D401E, mp4a.40.2"
	// high: video/mp4; codecs="avc1.64001E, mp4a.40.2"

	const buf = ms.addSourceBuffer('video/mp4; codecs="avc1.42E01E"')
	const queue = []

	buf.addEventListener('update', function() {
		if (queue.length > 0 && !buf.updating) {
			buf.appendBuffer(queue.shift());
		}
	})

	ws.addEventListener('message', function(e) {
		if (typeof e.data !== 'string') {
			if (buf.updating || queue.length > 0) {
				queue.push(e.data)
			} else {
				buf.appendBuffer(e.data)
			}
		}
	}, false)

})
</script>
</body>
</html>
```
