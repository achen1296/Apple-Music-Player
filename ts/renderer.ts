"use strict";

declare function backendRequest(url: string): Promise<string>;

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

async function switchTrack(trackID: string) {
    if (!trackID) {
        return; // e.g. undefined for empty track queue, silently ignore
    }
    currentAudio.src = `app://trackfile/${trackID}`;

    currentAudio.playbackRate = Number(playRateSlider.value); // this isn't remembered automatically (unlike volume)

    const trackMeta = JSON.parse(await backendRequest(`app://trackmeta/${trackID}`));
    const { name, album, artist } = trackMeta;

    currentTrackNameText.innerText = name;
    currentTrackArtistText.innerText = artist || "(no artist)";
    currentTrackAlbumText.innerText = album || "(no album)";
}

/*
What exactly do shuffle and repeat do in Apple Music?
- Obviously, when repeating only one song, shuffle is irrelevant.
- When shuffle is toggled on, the entire current album/playlist (henceforth just called "the list") except for the song currently playing is shuffled into the queue, even tracks that are before the current one, and including as many copies of each track as were present in the list multiple times.
    - If not repeating, playback stops after EVERY song in the list is played.
    - If repeating, no song may repeat again until the entire list has been exhausted -- in other words, the list is sampled WITHOUT replacement until it is empty, and then it is refilled, rather than simply being sampled WITH replacement.
- When shuffle is toggled off, the current song is located in the default order (its first occurrence if it is present more than once) and the position in the list is set there.
    - If not repeating, playback stops after the LAST song in the list is played, even if playback was started in the middle of the list.
    - If repeating, after the last song loops back to the first song.

When repeating only one song, Apple Music changes the queue to display only that song many times. I decided I would rather still display the queue of other songs, making it easier to switch songs from the queue (e.g. if shuffle is on) without toggling the repeat mode.
*/

enum RepeatSetting {
    NONE,
    ALL,
    ONE,
};
let repeat = RepeatSetting.NONE;
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

let shuffle = false;
shuffleButton.addEventListener("click", ev => {
    if (shuffle) {
        shuffle = false;
        shuffleButton.classList.remove("topBarButtonActive");
    } else {
        shuffle = true;
        shuffleButton.classList.add("topBarButtonActive");
    }
});

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
/** Tracks that are going to play next. The symbol `REPEAT_MARKER` is used to mark the point where a repeat of all tracks occurred. Therefore, if repeat is turned off, everything after the first appearance of `REPEAT_MARKER` is discarded from the queue. */
let trackQueue: (string | typeof REPEAT_MARKER)[] = [];
let trackIndex = 0;

function switchTrackQueue(newTrackQueue: string[]) {
    trackQueue = newTrackQueue.filter(i => i); // remove empty strings from splitting e.g. "".split(" ") -> [""]
    trackIndex = 0;
    switchTrack(trackQueue[0]);
}

function previousTrack() {
    trackIndex--;
    trackIndex %= trackQueue.length;
    switchTrack(trackQueue[trackIndex]);
}

function nextTrack() {
    trackIndex++;
    trackIndex %= trackQueue.length;
    switchTrack(trackQueue[trackIndex]);
}

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
    const albumIDs = await backendRequest("app://albumlist");
    if (albumList.firstElementChild) {
        // remove "Loading..."
        albumList.removeChild(albumList.firstElementChild);
    }
    for (const albumID of albumIDs.split(" ")) {
        const a = albumList
            .appendChild(document.createElement("li"))
            .appendChild(document.createElement("a"));
        const albumMeta = JSON.parse(await backendRequest(`app://albummeta/${albumID}`));
        const { name, artist } = albumMeta;
        a.innerText = `${name}${artist ? ` by ${artist}` : ""}`;
        a.addEventListener("click", async ev => {
            switchTrackQueue((await backendRequest(`app://albumitems/${albumID}`)).split(" "));
        });
    }
}

loadAlbumList();

async function loadPlaylistList() {
    const playlistIDs = await backendRequest("app://playlistlist");
    if (playlistList.firstElementChild) {
        // remove "Loading..."
        playlistList.removeChild(playlistList.firstElementChild);
    }
    for (const playlistID of playlistIDs.split(" ")) {
        const a = playlistList
            .appendChild(document.createElement("li"))
            .appendChild(document.createElement("a"));
        const playlistMeta = JSON.parse(await backendRequest(`app://playlistmeta/${playlistID}`));
        a.innerText = playlistMeta["name"];
        a.addEventListener("click", async ev => {
            switchTrackQueue((await backendRequest(`app://playlistitems/${playlistID}`)).split(" "));
        });
    }
}

loadPlaylistList();