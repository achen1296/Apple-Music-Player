# Communication Protocol Between Electron JS Frontend and Python Backend

Using ZeroMQ to communicate over TCP sockets. This application isn't _that_ complicated and it doesn't require amazing performance for communication with the backend, so I decided to just make a simple protocol myself (that is, without any additional libraries).

Requests may be made from the frontend either through the app:// custom protocol, or directly by using `backendRequest()` (sends request as a URL anyway to match the app:// protocol for simplicity).

## Errors

For any kind of error, the return value is "error" followed by a space and then an error message. The app:// protocol will convert this into a status 400 response with the message attached as the body.

## Getting Library Data

Whenever the return value is a file path below, the app:// protocol is set up to load the actual file data for use as a src value for audio/image/etc.

All IDs are in hexadecimal format (and they are all 8 bytes/16 hexadecimal digits).

### Host: <album/artist/track/playlist>list

No arguments.

Returns: space-separated list of ALL track/album/playlist IDs

### Host: <album/artist/track/playlist>meta

Pathname: Track/album/playlist ID

Returns: Track/album/playlist metadata as JSON string, not including the list of tracks for album/playlist

### Host: <album/playlist>items

Pathname: Album/playlist ID

Returns: space-separated list of track IDs

### Host: trackfile

Pathname: Track ID

Returns: File path (as a URL already since that's how it's stored)

### Host: artwork

Pathname: Album/artist/track/playlist ID

Returns: File path

## Updating Library Data

(todo... e.g. set play/skip count)
