import type { AudioResource, VoiceConnection } from "@discordjs/voice";

// @discordjs/voice hardcodes Speaking flag 1 (Microphone), which makes Discord
// downmix to mono. Flag 3 (Microphone | Soundshare) preserves stereo.
// Patches Networking.setSpeaking — pin @discordjs/voice to 0.19.x.
export function patchConnectionForStereo(connection: VoiceConnection): void {
  const patch = () => {
    // biome-ignore lint/suspicious/noExplicitAny: accessing @discordjs/voice internals
    const state = connection.state as any;
    if (state.status !== "ready" || !state.networking) {
      return;
    }

    const { networking } = state;
    networking.setSpeaking = function (speaking: boolean) {
      const ns = this.state;
      if (ns.code !== 4) {
        return;
      }
      if (ns.connectionData.speaking === speaking) {
        return;
      }
      ns.connectionData.speaking = speaking;
      ns.ws.sendPacket({
        d: {
          delay: 0,
          speaking: speaking ? 3 : 0, // Microphone|Soundshare (1|2) → stereo
          ssrc: ns.connectionData.ssrc,
        },
        op: 5, // VoiceOpcodes.Speaking
      });
    };
  };

  patch();
  connection.on("stateChange", patch);
}

// Configure the Opus encoder on an AudioResource for high-quality stereo.
// Bypasses prism-media's 128kbps cap via raw CTL calls.
export function configureStereoEncoder(resource: AudioResource): void {
  if (!resource.encoder) {
    return;
  }
  // biome-ignore lint/suspicious/noExplicitAny: accessing internal @discordjs/opus encoder
  const rawEncoder = (resource.encoder as any).encoder;
  const ctl = rawEncoder.applyEncoderCTL ?? rawEncoder.encoderCTL;
  ctl.call(rawEncoder, 4002, 256_000); // OPUS_SET_BITRATE
  ctl.call(rawEncoder, 4022, 2); // OPUS_SET_FORCE_CHANNELS = stereo
  resource.encoder.setFEC(true);
  resource.encoder.setPLP(0.05);
}
