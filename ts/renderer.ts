"use strict";

declare function backendRequest(url: string, body?: string): Promise<string>;

function dateToInt(date: Date) {
    // .valueOf is in milliseconds, but only stored as integer seconds in library
    return Math.floor(date.valueOf() / 1000) + 2082844800;
}

function intToDate(i: number) {
    return new Date((i - 2082844800) * 1000);
}

type AlbumMeta = { name: string, artist: string };
type ArtistMeta = { name: string };
type TrackMeta = {
    name: string,
    album: string,
    artist: string,
    plays_skips: {
        date_last_played: number,
        play_count: number,
        true_play_count: number,
        date_first_played: number,
        date_last_skipped: number,
        skip_count: number,
        true_skip_count: number,
    }
};
type PlaylistMeta = { name: string };

// https://stackoverflow.com/questions/41980195/recursive-partialt-in-typescript
type RecursivePartial<T> = {
    [P in keyof T]?:
    T[P] extends (infer U)[] ? RecursivePartial<U>[] :
    T[P] extends object | undefined ? RecursivePartial<T[P]> :
    T[P];
};

const request = {
    albumList: async function () {
        return (await backendRequest("app://albumList")).split(" ");
    },
    artistList: async function () {
        return (await backendRequest("app://artistList")).split(" ");
    },
    trackList: async function () {
        return (await backendRequest("app://trackList")).split(" ");
    },
    playlistList: async function () {
        return (await backendRequest("app://playlistList")).split(" ");
    },
    albumMeta: async function (albumID: string): Promise<AlbumMeta> {
        return JSON.parse(await backendRequest(`app://albumMeta/${albumID}`));
    },
    artistMeta: async function (artistID: string): Promise<ArtistMeta> {
        return JSON.parse(await backendRequest(`app://artistMeta/${artistID}`));
    },
    trackMeta: async function (trackID: string): Promise<TrackMeta> {
        return JSON.parse(await backendRequest(`app://trackMeta/${trackID}`));
    },
    playlistMeta: async function (playlistID: string): Promise<PlaylistMeta> {
        return JSON.parse(await backendRequest(`app://playlistMeta/${playlistID}`));
    },
    albumItems: async function (albumID: string) {
        return (await backendRequest(`app://albumItems/${albumID}`)).split(" ");
    },
    playlistItems: async function (playlistID: string) {
        return (await backendRequest(`app://playlistItems/${playlistID}`)).split(" ");
    },
    albumUpdate: async function (albumID: string, data: RecursivePartial<AlbumMeta>) {
        await backendRequest(`app://albumUpdate/${albumID}`, JSON.stringify(data));
    },
    artistUpdate: async function (artistID: string, data: RecursivePartial<ArtistMeta>) {
        await backendRequest(`app://artistUpdate/${artistID}`, JSON.stringify(data));
    },
    trackUpdate: async function (trackID: string, data: RecursivePartial<TrackMeta>) {
        await backendRequest(`app://trackUpdate/${trackID}`, JSON.stringify(data));
    },
    playlistUpdate: async function (playlistID: string, data: RecursivePartial<PlaylistMeta>) {
        await backendRequest(`app://playlistUpdate/${playlistID}`, JSON.stringify(data));
    },
};

const customSrc = {
    trackFile: (trackID: string) => `app://trackFile/${trackID}`,
    artwork: (artworkID: string) => `app://artwork/${artworkID}`,
};

// player

const currentTrackImage = document.getElementById("currentTrackImage") as HTMLImageElement;
const currentTrackNameText = document.getElementById("currentTrackNameText") as HTMLSpanElement;
const currentTrackArtistText = document.getElementById("currentTrackArtistText") as HTMLSpanElement;
const currentTrackAlbumText = document.getElementById("currentTrackAlbumText") as HTMLSpanElement;

const currentAudio = document.getElementById("currentAudio") as HTMLAudioElement;

const playTimeSlider = document.getElementById("playTimeSlider") as HTMLInputElement;
const playTimeText = document.getElementById("playTimeText") as HTMLSpanElement;

const skipPreviousButton = document.getElementById("skipPreviousButton") as HTMLButtonElement;
const playPauseButton = document.getElementById("playPauseButton") as HTMLButtonElement;
const skipNextButton = document.getElementById("skipNextButton") as HTMLButtonElement;
const repeatButton = document.getElementById("repeatButton") as HTMLButtonElement;
const shuffleButton = document.getElementById("shuffleButton") as HTMLButtonElement;

const volumeSlider = document.getElementById("volumeSlider") as HTMLInputElement;
const volumeText = document.getElementById("volumeText") as HTMLSpanElement;

const playRateSlider = document.getElementById("playRateSlider") as HTMLInputElement;
const playRateText = document.getElementById("playRateText") as HTMLSpanElement;
const preservePitchCheckbox = document.getElementById("preservePitchCheckbox") as HTMLInputElement;

const historyTabButton = document.getElementById("historyTabButton") as HTMLButtonElement;
const queueTabButton = document.getElementById("queueTabButton") as HTMLButtonElement;

const trackHistoryList = document.getElementById("trackHistoryList") as HTMLUListElement;
const trackQueueList = document.getElementById("trackQueueList") as HTMLUListElement;

let repeatOne = false;
let shuffle = false;

/** Maximum length of trackHistory to keep. Actually, I store a count as well as the ID so that repeating the same song many times doesn't fill up the history. */
const MAX_HISTORY = 50;
const trackHistory: [string, number][] = [];

/** `null` if nothing is playing */
let trackNowPlaying: string | null = null;

/** Current album or playlist -- all tracks in order */
let trackSourceList: string[] = [];
/** Used to sample from when shuffling, hence "population" as in random sampling terminology */
let trackSourceListShufflePopulation: string[] = [];
/** Position in `trackSourceList` to pull next for `trackQueue`. Can't directly use `trackSourceList` in case the user wants to manually add tracks to play next. */
let trackSourceListNext = 0;

/** Maximum length of `trackQueue` to remember before `trackIndex`. Can be larger because it's not shown anywhere on the GUI. */
const MAX_BACKWARDS_QUEUE = 100;
/** Maximum length of `trackQueue` to calculate and display in advance, not including elements before `trackIndex`. (The user may manually add more tracks up next than this and they won't be actively discarded. The forward queue can also grow by skipping backwards a lot.) */
const MAX_FORWARD_QUEUE = 20;
/**
 * Before `trackIndex`: tracks that will play when skipping backwards
 *
 * At `trackIndex`: playing now
 *
 * After `trackIndex`: up next
 *
 * Note that skipping backwards does not use the play history -- for example, when starting playback in the middle of a list that is not shuffled. Also, tracks may be added by the user to play next, so they may not necessarily be part of the `trackSourceList`.
 * */
let trackQueue: string[] = [];
let trackIndex = 0;

function trackOneLineDescription({ name, album, artist }: { name: string, album: string, artist: string }): string {
    return `${name}${album ? ` from ${album}` : ""}${artist ? ` by ${artist}` : ""}`;
}

async function addTrackHistory(trackID: string) {
    if (!trackID) {
        return;
    }

    if (trackHistory.length > 0 && trackHistory[trackHistory.length - 1][0] === trackID) {
        // same track, increment count
        trackHistory[trackHistory.length - 1][1]++;
        const historyRepeatCount = trackHistory[trackHistory.length - 1][1];
        const li = trackHistoryList.children[trackHistoryList.children.length - 1] as HTMLLIElement;
        if (li.innerText.match(/ \(x\d+\)$/)) {
            li.innerText = li.innerText.replace(/ \(x\d+\)$/, ` (x${historyRepeatCount})`);
        } else {
            li.innerText += ` (x${historyRepeatCount})`;
        }
    } else {
        trackHistory.push([trackID, 1]);
        const li = trackHistoryList.appendChild(document.createElement("li"));
        const trackMeta = await request.trackMeta(trackID);
        li.innerText = trackOneLineDescription(trackMeta);
        // start playing the track clicked but continue the same queue after
        li.addEventListener("click", ev => {
            trackIndex++;
            trackQueue.splice(trackIndex, 0, trackID);
            switchTrack(trackQueue[trackIndex] as string);
        });
    }

    if (trackHistory.length > MAX_HISTORY) {
        trackHistory.splice(0, 1);
        if (trackHistoryList.firstElementChild) {
            trackHistoryList.removeChild(trackHistoryList.firstElementChild);
        }
    }
}

async function refillTrackQueue() {
    async function pushQueue(trackID: string) {
        trackQueue.push(trackID);

        const li = trackQueueList.appendChild(document.createElement("li"));
        const trackMeta = await request.trackMeta(trackID);
        li.innerText = trackOneLineDescription(trackMeta);
        // jump ahead to the item that was clicked
        li.addEventListener("click", ev => {
            while (trackQueueList.firstElementChild && trackQueueList.firstElementChild !== li) {
                trackIndex++;
                trackQueueList.removeChild(trackQueueList.firstElementChild);
            }
            trackIndex++;
            trackQueueList.removeChild(li);
            switchTrack(trackQueue[trackIndex] as string);
        });
    }

    if (shuffle) {
        // random sample without replacement until empty
        while (trackQueue.length - (trackIndex + 1) < MAX_FORWARD_QUEUE) {
            if (trackSourceListShufflePopulation.length === 0) {
                // refill
                trackSourceListShufflePopulation = [...trackSourceList];
            }
            const i = Math.floor(Math.random() * trackSourceListShufflePopulation.length);
            await pushQueue(trackSourceListShufflePopulation.splice(i, 1)[0]);
        }
    } else {
        while (trackQueue.length - (trackIndex + 1) < MAX_FORWARD_QUEUE) {
            if (trackSourceListNext >= trackSourceList.length) {
                trackSourceListNext = 0;
            }
            await pushQueue(trackSourceList[trackSourceListNext]);
            trackSourceListNext++;
        }
    }
}

historyTabButton.addEventListener("click", ev => {
    historyTabButton.classList.add("buttonPressed");
    queueTabButton.classList.remove("buttonPressed");
    trackHistoryList.style.display = "block";
    trackQueueList.style.display = "none";
});

queueTabButton.addEventListener("click", ev => {
    queueTabButton.classList.add("buttonPressed");
    historyTabButton.classList.remove("buttonPressed");
    trackQueueList.style.display = "block";
    trackHistoryList.style.display = "none";
});

async function incrementPlays(trackID: string) {
    const { plays_skips } = await request.trackMeta(trackID);

    const now = dateToInt(new Date());

    const update: RecursivePartial<TrackMeta> = {
        plays_skips: {
            date_last_played: now,
            play_count: plays_skips.play_count + 1,
            true_play_count: plays_skips.true_play_count + 1,
        }
    };

    if (plays_skips.date_first_played === 0) {
        // @ts-ignore
        update.plays_skips.date_first_played = now;
        console.log(`first play ${now}`);
    }

    await request.trackUpdate(trackID, update);

    // @ts-ignore
    console.log(`${trackID} incremented plays to ${update.plays_skips.play_count} (true ${update.plays_skips.true_play_count}), last played ${update.plays_skips.date_last_played}`);
}

async function incrementSkips(trackID: string) {
    const { plays_skips } = await request.trackMeta(trackID);

    const now = dateToInt(new Date());

    const update: RecursivePartial<TrackMeta> = {
        plays_skips: {
            date_last_skipped: now,
            skip_count: plays_skips.skip_count + 1,
            true_skip_count: plays_skips.true_skip_count + 1,
        }
    };

    await request.trackUpdate(trackID, update);

    // @ts-ignore
    console.log(`${trackID} incremented skips to ${update.plays_skips.skip_count} (true ${update.plays_skips.true_skip_count}), last skipped ${update.plays_skips.date_last_skipped}`);
}

async function switchTrack(trackID: string) {
    if (!trackID) {
        // e.g. undefined for out-of-bounds index, i.e. empty track queue, reaching the end, or skipping backwards beyond the start
        currentAudio.src = "";
        // this should load the default image
        currentTrackImage.src = customSrc.artwork("00");
        currentTrackNameText.innerText = "...";
        currentTrackArtistText.innerText = "...";
        currentTrackAlbumText.innerText = "...";
        return;
    }

    if (trackNowPlaying) {
        await addTrackHistory(trackNowPlaying);

        const playFraction = currentAudio.currentTime / currentAudio.duration;

        if (playFraction <= 0.2) {
            // count a skip
            await incrementSkips(trackNowPlaying);
        } else if (playFraction >= 0.8) {
            // count a play
            await incrementPlays(trackNowPlaying);
        }

    }

    const wasPaused = currentAudio.paused;

    trackNowPlaying = trackID;

    if (trackIndex > MAX_BACKWARDS_QUEUE) {
        trackQueue.splice(0, trackIndex - MAX_BACKWARDS_QUEUE);
        trackIndex = MAX_BACKWARDS_QUEUE;
        // no effect on the display since only removing ones already not shown
    }

    currentAudio.src = customSrc.trackFile(trackID);
    currentAudio.playbackRate = Number(playRateSlider.value); // this isn't remembered automatically (unlike volume)
    if (!wasPaused) {
        // seems necessary if set to same track that was already playing
        // which can be either repeat one, or on list repeat when it happens to draw the last played song again as the first in the repeat
        currentAudio.play();
    }

    currentTrackImage.src = customSrc.artwork(trackID);

    const { name, album, artist } = await request.trackMeta(trackID);

    currentTrackNameText.innerText = name || "(no name)";
    currentTrackArtistText.innerText = artist || "(no artist)";
    currentTrackAlbumText.innerText = album || "(no album)";

    await refillTrackQueue();
}

async function initializeShuffledQueue(currentTrackID: string | null) {
    // discard track queue except for the current track if any
    // e.g. null for starting playback from the list of playlists/albums, non-null for enabling shuffle while already playing
    trackQueue = [];
    if (currentTrackID) {
        trackQueue.push(currentTrackID);
    }
    trackIndex = 0;

    // reset the sample
    trackSourceListShufflePopulation = [...trackSourceList];
    // except discard one copy of the current song if any
    if (currentTrackID) {
        const i = trackSourceListShufflePopulation.findIndex(t => t === currentTrackID);
        if (i > 0) {
            trackSourceListShufflePopulation.splice(i, 1);
        }
    }

    trackQueueList.replaceChildren();
    await refillTrackQueue();
}

function enableShuffle() {
    shuffle = true;

    shuffleButton.classList.add("buttonPressed");

    initializeShuffledQueue(trackQueue[trackIndex] as string);
}

async function initializeUnshuffledQueue(currentTrackID: string) {
    // locate first occurrence of the current track in the source list
    let startIndex = trackSourceList.findIndex(t => t === currentTrackID);
    if (startIndex === -1) {
        startIndex = 0; // failsafe in case e.g. the song was removed from the playlist
    }

    trackQueue = trackSourceList.slice(startIndex - MAX_BACKWARDS_QUEUE, startIndex); // fill in backwards queue

    trackQueueList.replaceChildren();

    // now playing
    trackIndex = trackQueue.length;
    trackQueue.push(currentTrackID);

    // fill in forwards queue
    trackSourceListNext = startIndex + 1;
    await refillTrackQueue();
}

function disableShuffle() {
    shuffle = false;

    shuffleButton.classList.remove("buttonPressed");

    initializeUnshuffledQueue(trackQueue[trackIndex] as string);
}

function toggleShuffle() {
    if (shuffle) {
        disableShuffle();
    } else {
        enableShuffle();
    }
}

function switchTrackSourceList(newTrackSourceList: string[], startIndex = 0) {
    trackSourceList = newTrackSourceList.filter(i => i); // remove empty strings from splitting e.g. "".split(" ") -> [""]

    if (shuffle) {
        initializeShuffledQueue(null);
    } else {
        initializeUnshuffledQueue(trackSourceList[startIndex]);
    }

    switchTrack(trackQueue[trackIndex] as string);
}

async function previousTrack() {
    if (trackQueue[trackIndex]) {
        // put the track that was playing back onto the displayed queue
        const li = trackQueueList.insertBefore(document.createElement("li"), trackQueueList.firstElementChild);
        const trackMeta = await request.trackMeta(trackQueue[trackIndex] as string);
        li.innerText = trackOneLineDescription(trackMeta);
    }
    trackIndex--;
    // clamp to -1, *not* to 0, so that skipping backwards at the start of the queue stops playback (which is how the official program does it, and also this is just less confusing than refusing to go backwards, although another alternative would be to disable the button; but see nextTrack)
    if (trackIndex < -1) {
        trackIndex = -1;
    }
    switchTrack(trackQueue[trackIndex] as string);
}

function nextTrack() {
    // likewise with previousTrack, except that falling off the end in this direction can be caused by regular playback reaching the end of the queue, and in that case it makes more sense to just stop playing
    trackIndex++;
    if (trackIndex >= trackQueue.length) {
        trackIndex = trackQueue.length;
    } else {
        // remove from displayed queue
        if (trackQueueList.firstElementChild) {
            trackQueueList.removeChild(trackQueueList.firstElementChild);
        }
    }

    switchTrack(trackQueue[trackIndex] as string);
}

shuffleButton.addEventListener("click", ev => toggleShuffle());

repeatButton.addEventListener("click", async ev => {
    if (repeatOne) {
        repeatOne = false;
        repeatButton.classList.remove("buttonPressed");
    }
    else {
        repeatOne = true;
        repeatButton.classList.add("buttonPressed");
    }
});

const SECONDS_FORMAT = Intl.NumberFormat(undefined, {
    minimumIntegerDigits: 2
});

function setPlayTimeText(currentTime: number, duration: number) {
    if (isNaN(duration)) {
        // without this briefly shows NaN / NaN every time the audio switches
        return;
    }

    let currentSeconds = currentTime % 60;
    const currentMinutes = (currentTime - currentSeconds) / 60;
    currentSeconds = Math.floor(currentSeconds);

    let durationSeconds = duration % 60;
    const durationMinutes = (duration - durationSeconds) / 60;
    durationSeconds = Math.floor(durationSeconds);

    playTimeText.innerText = `${currentMinutes}:${SECONDS_FORMAT.format(currentSeconds)} / ${durationMinutes}:${SECONDS_FORMAT.format(durationSeconds)}`;
}

currentAudio.addEventListener("timeupdate", ev => {
    setPlayTimeText(currentAudio.currentTime, currentAudio.duration);
    playTimeSlider.value = `${currentAudio.currentTime}`;
});

let inputtingOnPlayTimeSlider = false;
let audioWasPausedBeforeSeek = false;

playTimeSlider.addEventListener("input", ev => {
    if (!inputtingOnPlayTimeSlider) {
        // otherwise gets input many times quickly almost guaranteeing that audioWasPausedBeforeSeek will be set to true
        audioWasPausedBeforeSeek = currentAudio.paused;
        inputtingOnPlayTimeSlider = true;
    }
    currentAudio.pause(); // halt playback while seeking, and so the audio playback doesn't compete to set the play time text
    setPlayTimeText(Number(playTimeSlider.value), currentAudio.duration);
});

playTimeSlider.addEventListener("change", ev => {
    inputtingOnPlayTimeSlider = false;
    currentAudio.currentTime = Number(playTimeSlider.value);
    if (!audioWasPausedBeforeSeek) {
        currentAudio.play(); // resume if was playing before
    }
});

currentAudio.addEventListener("durationchange", ev => {
    playTimeSlider.max = `${currentAudio.duration}`;
});

skipPreviousButton.addEventListener("click", ev => previousTrack());

skipNextButton.addEventListener("click", ev => nextTrack());

currentAudio.addEventListener("ended", ev => {
    if (repeatOne) {
        switchTrack(trackNowPlaying as string);
    } else {
        nextTrack();
    }
});

playPauseButton.addEventListener("click", ev => {
    if (currentAudio.paused) {
        currentAudio.play();
    } else {
        currentAudio.pause();
    }
});

volumeSlider.addEventListener("input", ev => {
    currentAudio.volume = Number(volumeSlider.value) / 100;
    volumeText.innerText = `${volumeSlider.value}% volume`;
});

playRateSlider.addEventListener("input", ev => {
    const playRate = Number(playRateSlider.value);
    currentAudio.playbackRate = playRate;
    // number of decimal digits matches slider step
    playRateText.innerText = `${playRate.toFixed(2)}x speed`;
});

currentAudio.preservesPitch = preservePitchCheckbox.checked;
preservePitchCheckbox.addEventListener("change", ev => {
    currentAudio.preservesPitch = preservePitchCheckbox.checked;
});

// album and playlist lists

const albumsDiv = document.getElementById("albums") as HTMLDivElement;
const albumList = document.getElementById("albumList") as HTMLUListElement;

const playlistsDiv = document.getElementById("playlists") as HTMLDivElement;
const playlistList = document.getElementById("playlistList") as HTMLUListElement;


async function loadAlbumList() {
    const albumIDs = await request.albumList();
    if (albumList.firstElementChild) {
        // remove "Loading..."
        albumList.removeChild(albumList.firstElementChild);
    }
    for (const albumID of albumIDs) {
        const a = albumList
            .appendChild(document.createElement("li"))
            .appendChild(document.createElement("a"));
        const { name, artist } = await request.albumMeta(albumID);
        a.innerText = `${name}${artist ? ` by ${artist}` : ""}`;
        a.addEventListener("click", async ev => {
            switchTrackSourceList(await request.albumItems(albumID));
        });
    }
}

async function loadPlaylistList() {
    const playlistIDs = await request.playlistList();
    if (playlistList.firstElementChild) {
        // remove "Loading..."
        playlistList.removeChild(playlistList.firstElementChild);
    }
    for (const playlistID of playlistIDs) {
        const a = playlistList
            .appendChild(document.createElement("li"))
            .appendChild(document.createElement("a"));
        const { name } = await request.playlistMeta(playlistID);
        a.innerText = name;
        a.addEventListener("click", async ev => {
            switchTrackSourceList(await request.playlistItems(playlistID));
        });
    }
}

// expensive, do these last
loadAlbumList();
loadPlaylistList();