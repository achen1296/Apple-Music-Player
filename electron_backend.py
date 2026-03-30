import json
import os
import sqlite3
import sys
import traceback
from collections.abc import Callable
from datetime import datetime, timedelta
from pathlib import Path
from typing import Final
from urllib.parse import ParseResultBytes, urlparse

import zmq

from library_musicdb import Library, LibrarySearcher, Section

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


def album_list(parsed_url: ParseResultBytes, body: bytes | None):
    return " ".join(
        id_to_hex(a.get_int("id_album"))
        for a in LIBRARY.albums.children
    )


def artist_list(parsed_url: ParseResultBytes, body: bytes | None):
    return " ".join(
        id_to_hex(a.get_int("id_artist"))
        for a in LIBRARY.artists.children
    )


def track_list(parsed_url: ParseResultBytes, body: bytes | None):
    return " ".join(
        id_to_hex(t.get_int("id_track"))
        for t in LIBRARY.tracks.children
    )


def playlist_list(parsed_url: ParseResultBytes, body: bytes | None):
    return " ".join(
        id_to_hex(p.get_int("id_playlist"))
        for p in LIBRARY.playlists.children
    )


def _item_meta(parsed_url: ParseResultBytes, body: bytes | None, item_get: Callable[[int], Section]):
    id = hex_to_id(parsed_url.path.removeprefix(b"/"))
    item = item_get(id)
    return json.dumps(item.as_dict())


def album_meta(parsed_url: ParseResultBytes, body: bytes | None):
    return _item_meta(parsed_url, body, LIBRARY.album_by_id)


def artist_meta(parsed_url: ParseResultBytes, body: bytes | None):
    return _item_meta(parsed_url, body, LIBRARY.artist_by_id)


def track_meta(parsed_url: ParseResultBytes, body: bytes | None):
    return _item_meta(parsed_url, body, LIBRARY.track_by_id)


def playlist_meta(parsed_url: ParseResultBytes, body: bytes | None):
    return _item_meta(parsed_url, body, LIBRARY.playlist_by_id)


def album_items(parsed_url: ParseResultBytes, body: bytes | None):
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


def playlist_items(parsed_url: ParseResultBytes, body: bytes | None):
    id = hex_to_id(parsed_url.path.removeprefix(b"/"))
    playlist = LIBRARY.playlist_by_id(id)
    return " ".join(
        id_to_hex(i.get_int("id_track"))
        for i in PLAYLIST_ITEMS_SEARCHER.search(playlist)
    )


def track_file(parsed_url: ParseResultBytes, body: bytes | None):
    id = hex_to_id(parsed_url.path.removeprefix(b"/"))
    track = LIBRARY.track_by_id(id)
    return track.get_sub_string("url")


assert LIBRARY.file
ARTWORK_DB = sqlite3.connect(LIBRARY.file.with_name("artwork.sqlite"))
ARTWORK_FOLDER = LIBRARY.file.with_name("artwork")


def artwork(parsed_url: ParseResultBytes, body: bytes | None):
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


first_save_this_instance = True
most_recent_backup: datetime | None = None


def save_library():
    global first_save_this_instance, most_recent_backup

    assert LIBRARY.file

    now = datetime.now()

    if first_save_this_instance:
        first_save_this_instance = False

        # find backups older than 30 days and delete them, except for the first one each calendar month
        # doing this only on the first save of the program instance is more than enough assuming one doesn't leave the program open for durations on the order of months

        # checking for the most recent backup at this time (to determine if it is the first one today) should also be fine, assuming single instance; anyway, the worst that will happen is extra backups
        # rather than assuming the name format created by the save() function, we'll just check for any .musicdb file and use its birth time metadata

        library_backups: list[tuple[datetime, Path]] = []

        for f in LIBRARY.file.parent.iterdir():
            if f.suffix != ".musicdb":
                continue
            if f == LIBRARY.file:
                continue
            if "Preferences" in f.name:
                # don't consider "Library Preferences.musicdb" as a backup
                continue

            stat = f.stat()

            try:
                birth = stat.st_birthtime
            except AttributeError:
                birth = stat.st_ctime  # closest we'll get if st_birthtime is not available on this platform
            birth_datetime = datetime.fromtimestamp(birth)

            library_backups.append(
                (birth_datetime, f)
            )

        library_backups.sort(key=lambda t: t[0])

        last_month: tuple[int | None, int | None] = None, None
        to_delete: list[Path] = []
        for d, f in library_backups:
            month = d.year, d.month
            if month == last_month and now - d >= timedelta(days=30):
                to_delete.append(f)
                print(f"deleting {f}")
            else:
                print(f"not deleting {f}")
            last_month = month

        for f in to_delete:
            os.remove(f)

        if len(library_backups) > 0:
            most_recent_backup = library_backups[-1][0]

            print(f"most recent backup was made {most_recent_backup.isoformat()}")

    make_backup = (
        most_recent_backup is None
        or now - most_recent_backup >= timedelta(days=1)
    )
    print(f"make backup: {make_backup}")
    LIBRARY.save(LIBRARY.file, make_backup=make_backup)
    if make_backup:
        most_recent_backup = now


def _item_update(parsed_url: ParseResultBytes, body: bytes | None, get_item: Callable[[int], Section]):
    id = hex_to_id(parsed_url.path.removeprefix(b"/"))
    item = get_item(id)

    assert body
    new_data = json.loads(body)

    item.update(new_data)


def album_update(parsed_url: ParseResultBytes, body: bytes | None):
    _item_update(parsed_url, body, LIBRARY.album_by_id)


def artist_update(parsed_url: ParseResultBytes, body: bytes | None):
    _item_update(parsed_url, body, LIBRARY.artist_by_id)


def track_update(parsed_url: ParseResultBytes, body: bytes | None):
    _item_update(parsed_url, body, LIBRARY.track_by_id)


def playlist_update(parsed_url: ParseResultBytes, body: bytes | None):
    _item_update(parsed_url, body, LIBRARY.playlist_by_id)


def to_hostname(s: str):
    # urlparse makes the hostname all lowercase
    s = s.replace("_", "").lower()
    return s


HANDLERS: dict[str, Callable[[ParseResultBytes, bytes | None], bytes | str | None]] = {
    to_hostname(func.__name__): func
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
        album_update,
        artist_update,
        track_update,
        playlist_update,
    ]
}


def handle_request(parsed_url: ParseResultBytes, body: bytes | None) -> bytes:
    if not parsed_url.hostname:
        raise Exception("no hostname")
    try:
        handler = HANDLERS[parsed_url.hostname.decode()]
    except KeyError:
        raise Exception(f"unknown hostname {parsed_url.hostname}")

    result = handler(parsed_url, body)
    if not result:
        return b""  # ZMQ request-reply pattern, reply required
    if isinstance(result, str):
        result = result.encode()
    return result


DEBUG_LOG: Final[bool] = True

log_file = None
if DEBUG_LOG:
    log_file = open("backend_log.txt", "w")
    sys.stdout = log_file


def main(port: int):
    context = zmq.Context()
    socket = context.socket(zmq.REP)
    socket.bind(f"tcp://*:{port}")

    while True:
        received = socket.recv()
        if DEBUG_LOG:
            print("recv:", received)

        split_result = received.split(b" ", 1)
        if len(split_result) > 1:
            url, body = split_result
        else:
            url = split_result[0]
            body = None

        parsed_url = urlparse(url)

        try:
            response = handle_request(parsed_url, body)
        except Exception:
            response = f"error {traceback.format_exc()}".encode()  # send entire traceback to the main process console

        if DEBUG_LOG:
            print("send:", response)
            print()
        socket.send(response)

        if DEBUG_LOG:
            assert log_file
            log_file.flush()

        if parsed_url.hostname and b"update" in parsed_url.hostname:
            # do this AFTER sending the response back to avoid adding this delay to the GUI
            # todo handle this in a separate thread?
            save_library()


if __name__ == "__main__":
    port = int(sys.argv[1])
    main(port)
