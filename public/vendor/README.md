# Offline browser dependencies

EasyLoop is used on robot access-point networks without internet access. These
browser bundles are therefore committed under `public/vendor` and included in
standalone builds by the existing `public/**/*` pkg asset rule.

| Library | Version | Browser asset |
| --- | --- | --- |
| roslib | 1.0.1 | `roslib/roslib.min.js` |
| xterm | 5.3.0 | `xterm/xterm.js`, `xterm/xterm.css` |
| xterm-addon-fit | 0.8.0 | `xterm-addon-fit/xterm-addon-fit.js` |
| xterm-addon-search | 0.13.0 | `xterm-addon-search/xterm-addon-search.js` |

The files are the unmodified npm package artifacts for those exact versions.
Their licenses are stored beside each library.
