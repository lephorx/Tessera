# Third-party notices

Tessera is licensed under the MIT License (see [LICENSE](LICENSE)). It uses the
third-party software, fonts and images listed below, each under its own license.
The full license texts of npm and Python packages ship with those packages
(`frontend/node_modules/<package>/LICENSE`, the `*.dist-info` folders of the
Python packages).

Tessera is not an official Minecraft product. Not approved by or associated
with Mojang or Microsoft.

## Fonts (bundled into the dashboard build)

`next/font` downloads these fonts at build time and serves them from the
dashboard itself.

| Font | Copyright | License |
| --- | --- | --- |
| Montserrat | Copyright 2024 The Montserrat.Git Project Authors (https://github.com/JulietaUla/Montserrat.git) | SIL Open Font License 1.1 |
| Inter | Copyright (c) 2016 The Inter Project Authors (https://github.com/rsms/inter) | SIL Open Font License 1.1 |
| Geist Mono | Copyright (c) 2023 Vercel, in collaboration with basement.studio | SIL Open Font License 1.1 |

The SIL Open Font License 1.1 text is included at the end of this file.

## Dashboard (frontend, npm)

| Package | License |
| --- | --- |
| Next.js, React, React DOM | MIT |
| Radix UI (`radix-ui`) and shadcn/ui components (`shadcn`) | MIT |
| lucide-react (icons; includes icons from Feather, MIT) | ISC |
| CodeMirror (`@codemirror/*`), `@uiw/react-codemirror`, `@uiw/codemirror-theme-github` | MIT |
| sonner | MIT |
| clsx, tailwind-merge, tw-animate-css, Tailwind CSS | MIT |
| class-variance-authority | Apache-2.0 |

## API (backend, Python)

| Package | License |
| --- | --- |
| Flask, Werkzeug | BSD-3-Clause |
| requests | Apache-2.0 |
| Playwright for Python | Apache-2.0 |
| docker (Docker SDK for Python) | Apache-2.0 |
| websockets, python-dotenv | BSD-3-Clause |
| qrcode | BSD |
| dnspython | ISC |
| PyJWT, pyotp, APScheduler, gunicorn, nbtlib | MIT |

Playwright NOTICE (from the installed package):

```
Playwright
Copyright (c) Microsoft Corporation

This software contains code derived from the Puppeteer project (https://github.com/puppeteer/puppeteer),
available under the Apache 2.0 license (https://github.com/puppeteer/puppeteer/blob/master/LICENSE).
```

Playwright downloads Chromium when it is installed; Chromium's own notices
come with that download.

## Docker images (downloaded, not bundled)

| Image | License |
| --- | --- |
| [itzg/minecraft-server](https://github.com/itzg/docker-minecraft-server) (Java servers) | Apache-2.0 |
| [itzg/minecraft-bedrock-server](https://github.com/itzg/docker-minecraft-bedrock-server) (Bedrock servers) | MIT |
| [playit-cloud/playit-agent](https://github.com/playit-cloud/playit-agent) (optional Playit agent) | BSD-2-Clause |
| docker:cli (update helper) | Apache-2.0 |

When a server starts, these images download the Minecraft server software
(from Mojang, Paper, Fabric, Forge, Modrinth and others) onto your machine. That
software is not part of Tessera and comes under its own terms: Minecraft server
software under the [Minecraft EULA](https://aka.ms/MinecraftEULA), which you
accept for each server you create, and Bedrock Dedicated Server also under the
[Microsoft Privacy Policy](https://go.microsoft.com/fwlink/?LinkId=521839).

## Images loaded at runtime (not bundled)

- Item icons are loaded by your browser from [minecraft.wiki](https://minecraft.wiki).
- Player heads and skins are loaded by your browser from [mc-heads.net](https://mc-heads.net).

Tessera does not include or redistribute these images. Minecraft textures,
names and assets are © Mojang AB / Microsoft.

## SIL Open Font License 1.1

```
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION AND CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```
