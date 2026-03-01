"use strict";

declare function backendRequest(url: string): Promise<string>;

const request = {
    albumList: async function () {
        return (await backendRequest("app://albumlist")).split(" ");
    },
    artistList: async function () {
        return (await backendRequest("app://artistlist")).split(" ");
    },
    trackList: async function () {
        return (await backendRequest("app://tracklist")).split(" ");
    },
    playlistList: async function () {
        return (await backendRequest("app://playlistlist")).split(" ");
    },
    albumMeta: async function (albumID: string): Promise<
        { name: string, artist: string }
    > {
        return JSON.parse(await backendRequest(`app://albummeta/${albumID}`));
    },
    artistMeta: async function (artistID: string): Promise<
        { name: string }
    > {
        return JSON.parse(await backendRequest(`app://artistmeta/${artistID}`));
    },
    trackMeta: async function (trackID: string): Promise<
        { name: string, album: string, artist: string }
    > {
        return JSON.parse(await backendRequest(`app://trackmeta/${trackID}`));
    },
    playlistMeta: async function (playlistID: string): Promise<
        { name: string }
    > {
        return JSON.parse(await backendRequest(`app://playlistmeta/${playlistID}`));
    },
    albumItems: async function (albumID: string) {
        return (await backendRequest(`app://albumitems/${albumID}`)).split(" ");
    },
    playlistItems: async function (playlistID: string) {
        return (await backendRequest(`app://playlistitems/${playlistID}`)).split(" ");
    },
};

const customSrc = {
    trackFile: (trackID: string) => `app://trackfile/${trackID}`,
    artwork: (artworkID: string) => `app://artwork/${artworkID}`,
};

// player

const playerDiv = document.getElementById("player") as HTMLDivElement;

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

const trackHistoryList = document.getElementById("trackHistory") as HTMLUListElement;
const trackQueueList = document.getElementById("trackQueue") as HTMLUListElement;

enum RepeatSetting {
    NONE,
    ALL,
    ONE,
};
let repeat = RepeatSetting.NONE;

let shuffle = false;

/** Maximum length of trackHistory to keep. Actually, I store a count as well as the ID so that repeating the same song many times doesn't fill up the history. */
const MAX_HISTORY = 50;
const trackHistory: [string, number][] = [];

/** `null` if nothing is playing */
let trackNowPlaying: string | null = null;

/** Current album or playlist -- all tracks in order */
const trackSourceList: string[] = [];
/** Used to sample from when shuffling */
let trackSourceListShuffleSample: string[] = [];

/** Maximum length of trackQueue to calculate and display in advance (not including `REPEAT_MARKER`). */
const MAX_QUEUE = 20;
const REPEAT_MARKER = Symbol();
/**
 * Before `trackIndex`: tracks that will play when skipping backwards
 *
 * At `trackIndex`: playing now
 *
 * After `trackIndex`: up next
 *
 * Note that skipping backwards does not use the play history -- for example, when starting playback in the middle of a list that is not shuffled. Also, tracks may be added by the user to play next, so they may not necessarily be part of the `trackSourceList`.
 *
 * The symbol `REPEAT_MARKER` is used to mark the point where a repeat of all tracks occurred. Therefore, if repeat is turned off, everything after the first appearance of `REPEAT_MARKER` is discarded from the queue.
 * */
let trackQueue: (string | typeof REPEAT_MARKER)[] = [];
let trackIndex = 0;

async function addTrackHistory(trackID: string | typeof REPEAT_MARKER) {
    if (!trackID || trackID === REPEAT_MARKER) {
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
        const { name, album, artist } = await request.trackMeta(trackID);
        li.innerText = `${name}${album ? ` from ${album}` : ""}${artist ? ` by ${artist}` : ""}`;
    }

    if (trackHistory.length > MAX_HISTORY) {
        trackHistory.splice(0, 1);
        trackHistoryList.removeChild(trackHistoryList.children[0]);
    }
}

async function switchTrack(trackID: string) {
    if (!trackID) {
        return; // e.g. undefined for empty track queue, silently ignore
    }

    await addTrackHistory(trackQueue[trackIndex]);

    currentAudio.src = customSrc.trackFile(trackID);

    currentAudio.playbackRate = Number(playRateSlider.value); // this isn't remembered automatically (unlike volume)

    const { name, album, artist } = await request.trackMeta(trackID);

    currentTrackNameText.innerText = name;
    currentTrackArtistText.innerText = artist || "(no artist)";
    currentTrackAlbumText.innerText = album || "(no album)";
}

function switchTrackQueue(newTrackQueue: string[]) {
    trackQueue = newTrackQueue.filter(i => i); // remove empty strings from splitting e.g. "".split(" ") -> [""]
    trackIndex = 0;
    // REPEAT_MARKER shouldn't be first, but just in case...
    while (trackQueue[trackIndex] === REPEAT_MARKER) {
        trackIndex++;
    }
    switchTrack(trackQueue[0] as string);
}

function previousTrack() {
    do {
        trackIndex--;
        trackIndex %= trackQueue.length;
        // should never have a queue full of REPEAT_MARKER only...
    } while (trackQueue[trackIndex] === REPEAT_MARKER);
    switchTrack(trackQueue[trackIndex] as string);
}

function nextTrack() {
    do {
        trackIndex++;
        trackIndex %= trackQueue.length;
    } while (trackQueue[trackIndex] === REPEAT_MARKER);
    switchTrack(trackQueue[trackIndex] as string);
}

shuffleButton.addEventListener("click", ev => {
    if (shuffle) {
        shuffle = false;
        shuffleButton.classList.remove("topBarButtonActive");
    } else {
        shuffle = true;
        shuffleButton.classList.add("topBarButtonActive");
    }
});

repeatButton.addEventListener("click", ev => {
    switch (repeat) {
        case RepeatSetting.NONE:
            repeat = RepeatSetting.ALL;
            repeatButton.classList.add("topBarButtonActive");
            break;
        case RepeatSetting.ALL:
            repeat = RepeatSetting.ONE;
            repeatButton.innerText = "🔂";
            break;
        case RepeatSetting.ONE:
            repeat = RepeatSetting.NONE;
            repeatButton.innerText = "🔁";
            repeatButton.classList.remove("topBarButtonActive");
            break;
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
    if (!audioWasPausedBeforeSeek) {
        currentAudio.play(); // resume if was playing before
    }
    inputtingOnPlayTimeSlider = false;
    currentAudio.currentTime = Number(playTimeSlider.value);
});

currentAudio.addEventListener("durationchange", ev => {
    playTimeSlider.max = `${currentAudio.duration}`;
});

skipPreviousButton.addEventListener("click", ev => {
    previousTrack();
});

skipNextButton.addEventListener("click", ev => {
    nextTrack();
});

currentAudio.addEventListener("ended", ev => {
    nextTrack();
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
    // number of decimal digits matches slider step 0.1
    playRateText.innerText = `${playRate.toFixed(1)}x speed`;
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
            switchTrackQueue(await request.albumItems(albumID));
        });
    }
}

loadAlbumList();

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
            switchTrackQueue(await request.playlistItems(playlistID));
        });
    }
}

loadPlaylistList();