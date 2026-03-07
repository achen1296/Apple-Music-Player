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

const historyTabButton = document.getElementById("historyTabButton") as HTMLButtonElement;
const queueTabButton = document.getElementById("queueTabButton") as HTMLButtonElement;

const trackHistoryList = document.getElementById("trackHistoryList") as HTMLUListElement;
const trackQueueList = document.getElementById("trackQueueList") as HTMLUListElement;

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
let trackSourceList: string[] = [];
/** Used to sample from when shuffling, hence "population" as in random sampling terminology */
let trackSourceListShufflePopulation: string[] = [];
/** Position in `trackSourceList` to pull next for `trackQueue`. Can't directly use `trackSourceList` in case the user wants to manually add tracks to play next. */
let trackSourceListNext = 0;

/** Maximum length of `trackQueue` to remember before `trackIndex`. Can be larger because it's not shown anywhere on the GUI. */
const MAX_BACKWARDS_QUEUE = 100;
/** Maximum length of `trackQueue` to calculate and display in advance, not including `REPEAT_MARKER`, and not including elements before `trackIndex`. (The user may manually add more tracks up next than this and they won't be actively discarded. The forward queue can also grow by skipping backwards a lot.) */
const MAX_FORWARD_QUEUE = 20;
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

function trackOneLineDescription({ name, album, artist }: { name: string, album: string, artist: string }): string {
    return `${name}${album ? ` from ${album}` : ""}${artist ? ` by ${artist}` : ""}`;
}

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

function queueLengthNoRepeatMarker(start = 0, end?: number) {
    if (end === undefined) {
        end = trackQueue.length;
    }
    let markerCount = 0;
    for (let i = start; i < end; i++) {
        if (trackQueue[i] === REPEAT_MARKER) {
            markerCount++;
        }
    }
    return end - start - markerCount;
}

async function refillTrackQueue() {
    async function pushQueue(trackID: string | typeof REPEAT_MARKER) {
        trackQueue.push(trackID);
        if (trackID === REPEAT_MARKER) {
            return;
        }

        const li = trackQueueList.appendChild(document.createElement("li"));
        const trackMeta = await request.trackMeta(trackID);
        li.innerText = trackOneLineDescription(trackMeta);
        // jump ahead to the item that was clicked
        li.addEventListener("click", ev => {
            while (trackQueueList.firstElementChild && trackQueueList.firstElementChild !== li) {
                while (trackQueue[trackIndex] === REPEAT_MARKER) {
                    trackIndex++;
                }
                trackIndex++;
                trackQueueList.removeChild(trackQueueList.firstElementChild);
            }
            // once more to actually reach the li that was clicked
            while (trackQueue[trackIndex] === REPEAT_MARKER) {
                trackIndex++;
            }
            trackIndex++;
            trackQueueList.removeChild(li);
            switchTrack(trackQueue[trackIndex] as string);
        });
    }

    if (shuffle) {
        // random sample without replacement until empty
        while (queueLengthNoRepeatMarker(trackIndex + 1) < MAX_FORWARD_QUEUE) {
            if (trackSourceListShufflePopulation.length === 0) {
                if (repeat === RepeatSetting.ALL) {
                    // refill
                    trackSourceListShufflePopulation = [...trackSourceList];
                    await pushQueue(REPEAT_MARKER);
                } else {
                    break;
                }
            }
            const i = Math.floor(Math.random() * trackSourceListShufflePopulation.length);
            await pushQueue(trackSourceListShufflePopulation.splice(i, 1)[0]);
        }
    } else {
        while (queueLengthNoRepeatMarker(trackIndex + 1) < MAX_FORWARD_QUEUE) {
            if (trackSourceListNext >= trackSourceList.length) {
                if (repeat === RepeatSetting.ALL) {
                    trackSourceListNext = 0;
                    await pushQueue(REPEAT_MARKER);
                } else {
                    break;
                }
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

async function switchTrack(trackID: string) {
    if (!trackID) {
        // e.g. undefined for out-of-bounds index, i.e. empty track queue, reaching the end, or skipping backwards beyond the start
        currentAudio.src = "";
        currentTrackNameText.innerText = "...";
        currentTrackArtistText.innerText = "...";
        currentTrackAlbumText.innerText = "...";
        return;
    }

    await addTrackHistory(trackID);

    if (trackIndex > MAX_BACKWARDS_QUEUE) {
        trackQueue.splice(0, trackIndex - MAX_BACKWARDS_QUEUE);
        trackIndex = MAX_BACKWARDS_QUEUE;
        // no effect on the display since only removing ones already not shownf
    }

    currentAudio.src = customSrc.trackFile(trackID);

    currentAudio.playbackRate = Number(playRateSlider.value); // this isn't remembered automatically (unlike volume)

    const { name, album, artist } = await request.trackMeta(trackID);

    currentTrackNameText.innerText = name || "(no name)";
    currentTrackArtistText.innerText = artist || "(no artist)";
    currentTrackAlbumText.innerText = album || "(no album)";

    await refillTrackQueue();
}

async function initializeShuffledQueue(currentTrackID: string) {
    // discard track queue except for the current one
    trackQueue = [currentTrackID];
    trackIndex = 0;

    // reset the sample
    trackSourceListShufflePopulation = [...trackSourceList];
    // except discard one copy of the current song
    const i = trackSourceListShufflePopulation.findIndex(t => t === trackQueue[trackIndex]);
    if (i > 0) {
        trackSourceListShufflePopulation.splice(i, 1);
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
        initializeShuffledQueue(trackSourceList[startIndex]);
    } else {
        initializeUnshuffledQueue(trackSourceList[startIndex]);
    }

    while (trackQueue[trackIndex] === REPEAT_MARKER) {
        trackIndex++;
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
    do {
        trackIndex--;
        // if somehow there are a bunch of REPEAT_MARKER entries at the start of the queue (which shouldn't happen, but just in case), will just stop with the undefined value at -1
    } while (trackQueue[trackIndex] === REPEAT_MARKER);
    // clamp to -1, *not* to 0, so that skipping backwards at the start of the queue stops playback (which is how the official program does it, and also this is just less confusing than refusing to go backwards, although another alternative would be to disable the button; but see nextTrack)
    if (trackIndex < -1) {
        trackIndex = -1;
    }
    switchTrack(trackQueue[trackIndex] as string);
}

function nextTrack() {
    // likewise with previousTrack, except that falling off the end in this direction can be caused by regular playback reaching the end of the queue, and in that case it makes more sense to just stop playing
    do {
        trackIndex++;
    } while (trackQueue[trackIndex] === REPEAT_MARKER);
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

function discardRepeats() {
    if (shuffle) {
        // reset
        trackSourceListShufflePopulation = [...trackSourceList];
    }

    // search forward for REPEAT_MARKER and discard starting from there
    // (not backward)
    const i = trackQueue.findIndex(t => t === REPEAT_MARKER);
    if (i >= 0) {
        trackQueue.splice(i);
        trackQueueList.replaceChildren(...Array.from(trackQueueList.children).slice(0, i - trackIndex - 1));
    }
}

shuffleButton.addEventListener("click", ev => toggleShuffle());

repeatButton.addEventListener("click", async ev => {
    switch (repeat) {
        case RepeatSetting.NONE:
            repeat = RepeatSetting.ALL;
            repeatButton.classList.add("buttonPressed");
            await refillTrackQueue();
            break;
        case RepeatSetting.ALL:
            repeat = RepeatSetting.ONE;
            repeatButton.innerText = "🔂";
            // only "ended" event is affected by this, nothing to do do here
            break;
        case RepeatSetting.ONE:
            repeat = RepeatSetting.NONE;
            repeatButton.innerText = "🔁";
            repeatButton.classList.remove("buttonPressed");
            discardRepeats();
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

skipPreviousButton.addEventListener("click", ev => previousTrack());

// todo increment skip count
skipNextButton.addEventListener("click", ev => nextTrack());

currentAudio.addEventListener("ended", ev => {
    // todo increment play count
    if (repeat === RepeatSetting.ONE) {
        currentAudio.play(); // restart playback
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
            switchTrackSourceList(await request.albumItems(albumID));
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
            switchTrackSourceList(await request.playlistItems(playlistID));
        });
    }
}

loadPlaylistList();