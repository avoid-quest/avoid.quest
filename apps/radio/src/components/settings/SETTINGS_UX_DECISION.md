# Settings UX decision

The settings information architecture is the compact sidebar layout with the
sections General, Radios, Playback, MIDI, and Data (Export, Import, Reset).
General holds the small app-wide settings: the theme, the "Restore playback
state" switch, and the app version. Playback is the audio settings. The header
keeps only the "What's new" button in the theme toggle's place; the theme is
chosen in General. The player mode is chosen only from the header toggle, so it
is not repeated in settings. The layout keeps every settings feature, uses the
repository's shadcn/ui styling unchanged, keeps copy minimal, and preserves
existing default-tab entry points. Radios stays the section settings opens on.
General places the compact "What I know about you" disclosure below Version
and above the source links, keeping data transparency beside the app details.
