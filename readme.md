See also the readme for the Apple-Music-Editor repo, which this one uses as a submodule. This readme discusses the player interface itself.

# Why Python + Electron?

I had already written the editor backend in Python (as my go-to language) when I decided to create an alternative player GUI. While researching GUI options, the automatic and simple-to-implement audio support offered by Chromium via Electron was appealing. Add on that I have been wanting to learn more about HTML/CSS/JavaScript development and it seemed like a good choice. It's also good that this will hopefully make it cross-platform.

# Feature Differences Compared to Official Apple Music Player

Obviously, the reason why I wanted to make this alternative GUI at all is to add/change features and use it myself.

## Additional Features

- (todo) It is much faster to change a song's playlist memberships, especially multiple, with a different UI for this — just click on the checkbox.
- (todo) I will call this one "Semi-smart Playlists": Smart playlists where you can manually add additional tracks not meeting the smart criteria, and also manually remove tracks that do meet the criteria. Thus "semi-smart" because they are both smart and manually changed like normal playlists. (Internally, to maintain partial compatibility with the official program, this is implemented by adding a new playlist for the manual additions, another for the manual removals, moving all of them into a folder for organization, and then changing the smart playlist conditions to be: (<\original conditions\> OR track is in manual additions) AND track is not in manual removals]. You could of course do this directly in the official program, mine just makes it easier.)
- Being able to control the playback rate (which is conveniently something a web app can do natively).
- (todo) Being able to pitch shift.

## Different Features

### Shuffle and Repeat

What exactly does shuffle do in Apple Music? I refer to both albums and playlists as just "the list" below.

It is worth noting that the way these behave seemingly don't expect there to be more than one copy of each track in the list (only possible for playlists; the official program GUI tries to get you not to do this by showing a warning when adding a duplicate to a playlist, but it is still allowed).

When shuffling, the entire current album/playlist (henceforth just called "the list") except for the song currently playing is shuffled into the queue, even tracks that are before the current one, and including as many copies of each track as were present in the list multiple times. When repeating, no song may repeat again until the entire list has been exhausted -- in other words, the list is sampled WITHOUT replacement until it is empty, and then it is refilled, rather than simply being sampled WITH replacement.

I have decided to make my program behave differently in the following ways:

- When repeating only one song, Apple Music changes the queue to display only that song many times. I decided I would rather still display the queue of other songs, making it easier to switch songs from the queue (e.g. if you want a random sample by having shuffle on) without toggling the repeat mode.

## Omitted Features

These are features I will likely never add, because it isn't difficult to just open up the official program to do it, and some I consider unimportant.

- Any integration with the Apple Music/iTunes online storefront/subscription service, except for (todo) the link to "Show in iTunes store" (which was easy to implement as opening in the regular web browser so why not)
- Adding new tracks in general (that is, both from the store and from local files) (you don't do this nearly as often as editing/organizing and the official program already supports adding many tracks at once anyway)
- Generating playlist artwork from the preset options the official program offers (mainly gradients that the name is laid over)
    - (todo) My program generates a playlist artwork from the tracks in it, and you can also set a custom one, same as the official program
