# Safari radio support — 2026-10-06

WebKit live radio and all HLS (including SoundCloud/Mixcloud, live or finite) are
guarded wherever the audio graph runs; progressive files keep their existing path.
Single plays natively with the default output and zero output delay. iOS uses
device volume and native `muted`.

A standalone native Safari 27 test, with no app code, measured zero samples after
82.8 seconds of live NTS playback; a finite MP3 produced peak 0.935 through the
same graph. Audible native Single, physical iPhone/iPad playback, background
recovery, sustained listening and the full station/version matrix remain unverified.
[WebKit live-source report](https://bugs.webkit.org/show_bug.cgi?id=180696),
[HLS report](https://bugs.webkit.org/show_bug.cgi?id=306493),
[audioMotion limitation](https://github.com/hvianna/audioMotion-analyzer#visualization-of-live-streams-wont-work-on-safari).

[openDAW](https://github.com/andremichelle/openDAW/blob/52408ea0f62236bc9084aa4c73f156c163570da7/packages/studio/core/src/samples/SampleService.ts)
decodes finite samples, which does not prove live media-element support.
[Icecast Metadata Player](https://github.com/eshaz/icecast-metadata-js/tree/master/src/icecast-metadata-player)
has a separate Safari decoder backend; adopting it requires a larger integration.
The custom decoder experiment was removed after reported drops.

Separate limitation: WebKit's [COEP credentialless support](https://bugs.webkit.org/show_bug.cgi?id=230550)
is unresolved. Changing isolation headers needs an external-resource audit and
does not fix the independent live-source failure.

Sentry 151719978 was reproduced without Safari: stored channels disappear before
fade-out releases their effect bindings. Node lanes now reconcile their own
effects from the compiled plan and never bind channel effects, so a removed
channel is never read again. The Safari guard uses expected
`AppError` classification; ordinary browser failures still reach Sentry.
