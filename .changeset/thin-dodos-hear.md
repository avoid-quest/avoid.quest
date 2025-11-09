---
"radio": patch
---

Fix type errors in audio effect parameter components

- Fix `getDefaultValue` function type safety in biquad-filter and delay parameter components
- Update `ParamSelect` to accept readonly option arrays
- Add proper type guards for potentially undefined values in `param-slider`
- Fix optional chaining for `paramFormatters.default` in `param-definitions`
