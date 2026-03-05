import json
import sys
import traceback
from collections.abc import Callable
from typing import Final
from urllib.parse import ParseResultBytes, urlparse

import zmq

from library_musicdb import Library, LibrarySearcher

LIBRARY = Library()  # todo give the user a way to specify a non-default path


def flip_hex_endianness[T: str | bytes](hex: T) -> T:
    assert len(hex) % 2 == 0, hex
    if isinstance(hex, str):
        joiner = ""
    else:
        joiner = b""
    return joiner.join(hex[i-2:i] for i in range(len(hex), 0, -2))  # type: ignore

# everything would work fine as long as we are consistent about flipping/not flipping hex endianness in both of the below functions, however it's less confusing if the hex is ever printed out anywhere to compare it with the documentation and other Python code where the hex might be shown, which is worth a small runtime cost


def hex_to_id(hex: str | bytes):
    return int(flip_hex_endianness(hex), 16)


def id_to_hex(id: int):
    return flip_hex_endianness(f"{id:016x}")


def albumlist(parsed_url: ParseResultBytes):
    return " ".join(
        id_to_hex(a.get_int("id_album"))
        for a in LIBRARY.albums.children
    )


def artistlist(parsed_url: ParseResultBytes):
    return " ".join(
        id_to_hex(a.get_int("id_artist"))
        for a in LIBRARY.artists.children
    )


def tracklist(parsed_url: ParseResultBytes):
    return " ".join(
        id_to_hex(t.get_int("id_track"))
        for t in LIBRARY.tracks.children
    )


def playlistlist(parsed_url: ParseResultBytes):
    return " ".join(
        id_to_hex(p.get_int("id_playlist"))
        for p in LIBRARY.playlists.children
    )


def albummeta(parsed_url: ParseResultBytes):
    id = hex_to_id(parsed_url.path.removeprefix(b"/"))
    album = LIBRARY.album_by_id(id)
    return json.dumps({
        "name": album.get_sub_string("name"),
        "artist": album.get_sub_string("artist"),
    })


def artistmeta(parsed_url: ParseResultBytes):
    id = hex_to_id(parsed_url.path.removeprefix(b"/"))
    artist = LIBRARY.artist_by_id(id)
    return json.dumps({
        "name": artist.get_sub_string("name"),
    })


def trackmeta(parsed_url: ParseResultBytes):
    id = hex_to_id(parsed_url.path.removeprefix(b"/"))
    track = LIBRARY.track_by_id(id)
    return json.dumps({
        "name": track.get_sub_string("name"),
        "album": track.get_sub_string("album"),
        "artist": track.get_sub_string("artist"),
    })


def playlistmeta(parsed_url: ParseResultBytes):
    id = hex_to_id(parsed_url.path.removeprefix(b"/"))
    playlist = LIBRARY.playlist_by_id(id)
    return json.dumps({
        "name": playlist.get_sub_string("name"),
    })


def albumitems(parsed_url: ParseResultBytes):
    id = hex_to_id(parsed_url.path.removeprefix(b"/"))
    return " ".join(
        id_to_hex(t.get_int("id_track"))
        for t in LIBRARY.tracks.children
        if t.get_int("id_album") == id
    )


PLAYLIST_ITEMS_SEARCHER = (
    LibrarySearcher()
    .data_subsections_of_subtype("playlist_item", allow_multiple_per_parent=True)
    .children()
)


def playlistitems(parsed_url: ParseResultBytes):
    id = hex_to_id(parsed_url.path.removeprefix(b"/"))
    playlist = LIBRARY.playlist_by_id(id)
    return " ".join(
        id_to_hex(i.get_int("id_track"))
        for i in PLAYLIST_ITEMS_SEARCHER.search(playlist)
    )


def trackfile(parsed_url: ParseResultBytes):
    id = hex_to_id(parsed_url.path.removeprefix(b"/"))
    track = LIBRARY.track_by_id(id)
    return track.get_sub_string("file")


HANDLERS: dict[str, Callable[[ParseResultBytes], bytes | str]] = {
    func.__name__: func
    for func in [
        albumlist,
        artistlist,
        tracklist,
        playlistlist,
        albummeta,
        artistmeta,
        trackmeta,
        playlistmeta,
        albumitems,
        playlistitems,
        trackfile,
        # artwork,
    ]
}


def handle_request(url: bytes) -> bytes:
    parsed_url = urlparse(url)

    if not parsed_url.hostname:
        raise Exception("no hostname")
    try:
        handler = HANDLERS[parsed_url.hostname.decode()]
    except KeyError:
        raise Exception(f"unknown hostname {parsed_url.hostname}")

    result = handler(parsed_url)
    if isinstance(result, str):
        result = result.encode()
    return result


DEBUG_LOG: Final[bool] = True


def main(port: int):
    context = zmq.Context()
    socket = context.socket(zmq.REP)
    socket.bind(f"tcp://*:{port}")

    log_file = None
    if DEBUG_LOG:
        log_file = open("backend_log.txt", "wb")

    while True:
        url = socket.recv()

        if DEBUG_LOG:
            assert log_file
            log_file.write(b"recv: ")
            log_file.write(url)
            log_file.write(b"\n")

        try:
            response = handle_request(url)
        except Exception as x:
            response = f"error {traceback.format_exc()}".encode()  # send entire traceback to the main process console

        if DEBUG_LOG:
            assert log_file
            log_file.write(b"send: ")
            log_file.write(response)
            log_file.write(b"\n\n")

        socket.send(response)

        if DEBUG_LOG:
            assert log_file
            log_file.flush()


if __name__ == "__main__":
    port = int(sys.argv[1])
    main(port)
