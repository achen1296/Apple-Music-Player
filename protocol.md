# Communication Protocol Between Electron JS Frontend and Python Backend

Using ZeroMQ to communicate over TCP sockets. This application isn't _that_ complicated and it doesn't require amazing performance for communication with the backend, so I decided to just make a simple protocol myself (that is, without any additional libraries).

Requests may be made from the frontend either through the app:// custom protocol, or directly by using `backendRequest()` (sends request as a URL anyway to match the app:// protocol for simplicity).

An "item" refers to an album, artist, track, or playlist as appropriate from the context.

## Errors

For any kind of error, the return value is "error" followed by a space and then an error message. The app:// protocol will convert this into a status 400 response with the message attached as the body.

## Getting Library Data

Whenever the return value is a file path below, the app:// protocol is set up to load the actual file data for use as a src value for audio/image/etc.

All IDs are in hexadecimal format (and they are all 8 bytes/16 hexadecimal digits).

### Host: <album/artist/track/playlist>List

No arguments.

Returns: Space-separated list of ALL item IDs

### Host: <album/artist/track/playlist>Meta

Pathname: Item ID

Returns: Item metadata as JSON string. This does not including the list of tracks for album/playlist which require special logic (and it would also be expensive).

### Host: <album/playlist>Items

Pathname: Item ID

Returns: Space-separated list of track IDs

### Host: trackFile

Pathname: Track ID

Returns: File path (as a URL already since that's how it's stored)

### Host: artwork

Pathname: Item ID

Returns: File path

## Updating Library Data

If any modification is made, the library file will be saved once the program is closed. (See also [readme](readme.md) for backup strategy.)

### Host: <album/artist/track/playlist>Update

Pathname: Item ID

Body: JSON string to decode and pass to `Section.update` in the backend (pass dates as integers). Should be mostly intuitive if you understand the library structure; note that `BinaryObjectParentSection` overrides this method, which applies to all 4 of these item types. Example: to update a track's play count to 5, use `{ "plays_skips": { "play_count": 5 } }`. (In this case, should also increment `true_play_count`.)

Returns: Nothing
