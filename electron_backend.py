import sqlite3
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


def album_list(parsed_url: ParseResultBytes):
    return " ".join(
        id_to_hex(a.get_int("id_album"))
        for a in LIBRARY.albums.children
    )


def artist_list(parsed_url: ParseResultBytes):
    return " ".join(
        id_to_hex(a.get_int("id_artist"))
        for a in LIBRARY.artists.children
    )


def track_list(parsed_url: ParseResultBytes):
    return " ".join(
        id_to_hex(t.get_int("id_track"))
        for t in LIBRARY.tracks.children
    )


def playlist_list(parsed_url: ParseResultBytes):
    return " ".join(
        id_to_hex(p.get_int("id_playlist"))
        for p in LIBRARY.playlists.children
    )


def album_meta(parsed_url: ParseResultBytes):
    id = hex_to_id(parsed_url.path.removeprefix(b"/"))
    album = LIBRARY.album_by_id(id)
    return json.dumps({
        "name": album.get_sub_string("name"),
        "artist": album.get_sub_string("artist"),
    })


def artist_meta(parsed_url: ParseResultBytes):
    id = hex_to_id(parsed_url.path.removeprefix(b"/"))
    artist = LIBRARY.artist_by_id(id)
    return json.dumps({
        "name": artist.get_sub_string("name"),
    })


def track_meta(parsed_url: ParseResultBytes):
    id = hex_to_id(parsed_url.path.removeprefix(b"/"))
    track = LIBRARY.track_by_id(id)
    return json.dumps({
        "name": track.get_sub_string("name"),
        "album": track.get_sub_string("album"),
        "artist": track.get_sub_string("artist"),
    })


def playlist_meta(parsed_url: ParseResultBytes):
    id = hex_to_id(parsed_url.path.removeprefix(b"/"))
    playlist = LIBRARY.playlist_by_id(id)
    return json.dumps({
        "name": playlist.get_sub_string("name"),
    })


def album_items(parsed_url: ParseResultBytes):
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


def playlist_items(parsed_url: ParseResultBytes):
    id = hex_to_id(parsed_url.path.removeprefix(b"/"))
    playlist = LIBRARY.playlist_by_id(id)
    return " ".join(
        id_to_hex(i.get_int("id_track"))
        for i in PLAYLIST_ITEMS_SEARCHER.search(playlist)
    )


def track_file(parsed_url: ParseResultBytes):
    id = hex_to_id(parsed_url.path.removeprefix(b"/"))
    track = LIBRARY.track_by_id(id)
    return track.get_sub_string("url")


assert LIBRARY.file
ARTWORK_DB = sqlite3.connect(LIBRARY.file.with_name("artwork.sqlite"))
ARTWORK_FOLDER = LIBRARY.file.with_name("artwork")


def artwork(parsed_url: ParseResultBytes):
    id = hex_to_id(parsed_url.path.removeprefix(b"/"))

    # signed int in the artwork.sqlite file
    if id >= 1 << 63:
        id -= 1 << 64

    cursor = ARTWORK_DB.cursor()
    if result := cursor.execute("select artwork_id from item_to_artwork where item_id = ? ", [id]).fetchone():
        artwork_id = result[0]

        if result := cursor.execute("select size_kind, extension from cache_items where artwork_id = ?", [artwork_id]).fetchone():
            size_kind, extension = result

            return str(ARTWORK_FOLDER / f"{artwork_id}_sk{size_kind}.{extension}")

    return "assets/default_artwork.png"


def to_camel_case(s: str):
    s = s.title()
    s = s[0].lower() + s[1:]
    s = s.replace("_", "")
    return s


HANDLERS: dict[str, Callable[[ParseResultBytes], bytes | str]] = {
    to_camel_case(func.__name__): func
    for func in [
        album_list,
        artist_list,
        track_list,
        playlist_list,
        album_meta,
        artist_meta,
        track_meta,
        playlist_meta,
        album_items,
        playlist_items,
        track_file,
        artwork,
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
