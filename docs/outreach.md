# Link outreach

Candidates, contacts and draft email text for getting other sites to link to
uvatlas. Written 27 October 2026.

## Read this before sending anything

**The premise needs one correction.** Reciprocal link exchange — "link to me and
I'll link to you" — is named in Google's spam policies as a link scheme. The
operative word is *excessive*: a handful of relevant reciprocal links between
sites that genuinely serve the same readers is low risk, but a templated
campaign asking dozens of sites to swap is the exact pattern SpamBrain was built
to discount. What still works, and what every email below is written to ask for,
is **one-way inclusion on a page that already lists where to get the UV index**.
Several such pages exist and already link to BoM and myUV (WorkSafe WA, Sydney
North Health Network, Cancer Council state sites). Being added to one of those
is worth more than ten swaps.

So: lead with the resource, mention a reciprocal link only as an offer the other
side can take or leave, and never as the price of the link.

**Two things to fix first.**

1. `SITE_INDEXABLE` is still `"false"`. Every page serves
   `X-Robots-Tag: noindex, nofollow`. Links pointing at a noindex site do
   nothing, and a reviewer who checks will see a site that tells Google to go
   away. Flip it and submit the sitemaps before the first email goes out.
2. Ads are off and ARPANSA's written authorisation is still outstanding
   (`docs/licences.md`). Health bodies will look at the data credits. The
   `/methods/` page is the strongest asset in any of these emails — point at it
   early.

## Candidates

Tiers are by what to ask for, not by how good the link is.

### Tier 1 — resource-page inclusion (ask for a one-way link, offer nothing)

These are health and safety bodies. They will not swap links, and asking them to
would end the conversation. They *do* maintain pages listing where to find the
UV index, which is exactly what uvatlas is.

| Organisation | Why them | Contact | Status |
|---|---|---|---|
| ARPANSA | Already the data source for every AU reading. The relationship exists; the licence request is open anyway. | Use the **contact form** at arpansa.gov.au/contact-us. `info@arpansa.gov.au` appears in their annual reports but not on the live contact page; phone 1800 022 333 | Form only |
| Cancer Council Victoria / SunSmart | Runs SunSmart and myUV. Most likely to see uvatlas as a competitor to myUV — pitch the per-city pages and the "this time of year" normals, which myUV has not got. | `enquiries@cancervic.org.au`. No SunSmart address is published; media goes through a separate staff-contacts page | **Verified** |
| Cancer Council SA | Maintains a SunSmart and skin resources page with a "useful web links" section | `cc@cancersa.org.au` (general), `media@cancersa.org.au`, 08 8291 4111 | **Verified** |
| Cancer Council Queensland | Has a UV exposure protection resource collection | `info@cancerqld.org.au`, and `Reducingcancerrisk@cancerqld.org.au` — the better target here | **Verified** |
| WorkSafe WA | Its outdoor-worker page already links BoM and myUV for the daily UV index | `CommunityEducationOfficers@lgirs.wa.gov.au` (education, the right door); general `wscallcentre@lgirs.wa.gov.au` | **Verified** |
| Sydney North Health Network | Published a "use the UV index" article listing where to find it | `info@snhn.org.au`, (02) 9432 8250 | **Verified** |
| Melanoma Institute Australia | Large AU audience, prevention content | `info@melanoma.org.au`, media `media@melanoma.org.au` | **Verified** |
| The Skin Cancer Foundation (US) | The obvious US equivalent; runs free education programs that need a UV source | `info@skincancer.org`, 212.725.5176 | **Verified** |
| AIM at Melanoma (US) | Prevention and outreach material | `EngageUs@AIMatMelanoma.org`, marketing `marketing@AIMatMelanoma.org` | **Verified** |
| Richard David Kann Melanoma Foundation (US) | Runs SunSmart America K-12 curriculum — a curriculum needs a live UV source | `info@melanomafoundation.com`, 561-655-9655 | **Verified** |
| Melanoma Research Foundation (US) | melanoma.org | `info@melanoma.org`, media `media@melanoma.org`, (202) 347-9675 | **Verified** |
| Outrun the Sun (US) | Smaller nonprofit, school curricula | `info@outrunthesun.org`, (317) 253-2121 | **Verified** |

### Tier 2 — genuine reciprocal candidates (a swap here is defensible)

Independent sites of similar scale whose readers are outdoors at midday, and
which uvatlas can honestly link back to from city pages or
`/uv-index-explained/`. These are where the actual exchange offer belongs.

| Site | Why them | Contact | Status |
|---|---|---|---|
| The Bushwalking Blog (bushwalkingblog.com.au) | Long-running independent AU bushwalking site, run by one person — the kind of site that answers email | `neil_fahey@hotmail.com` (Neil Fahey), or the contact form | **Verified** |
| Trail Hiking Australia (trailhiking.com.au) | Trail database with a resources section for trip planning | `explore@trailhiking.com.au` (Darren Edwards). There is no `/contact/` page; the relevant one is `/contribute/work-with-me/` | **Verified** |
| Wild Magazine (wild.com.au) | AU bushwalking, climbing, paddling | `editor@wild.com.au` (James McCormack) is the right door; general `contact@wild.com.au` | **Verified** |
| Independent AU surf forecast sites | Midday audience, UV is a natural addition to a surf report | Per site | Unverified |
| AU caravan/camping community sites | Grey-nomad audience, high skin-cancer awareness | Per site | Unverified |
| AU/US gardening sites | Same midday exposure, rarely covered by UV content | Per site | Unverified |
| Outdoor-work safety and workwear suppliers | Will almost always say yes — which is the problem. Low quality, commercial. Take only if the page is a genuine safety resource. | Per site | Unverified |

### Tier 3 — not worth the email

- Weather portals (weather.com, Weatherzone, AccuWeather). Direct competitors
  for the exact terms in `docs/seo.md`. They will not link out.
- Link-exchange directories and "we'll add you to our partners page" outfits.
  This is the pattern Google penalises, and it is the one thing that can undo
  the Tier 1 links.
- Sunscreen brands. Commercial, and a brand link next to a reading muddies the
  independence the `/methods/` page is built on.

## Email drafts

Each is short on purpose. Fill the `[square brackets]`. Send individually, from
a real address, never as a mail-merge.

### A — health and safety bodies (Tier 1)

> **Subject:** A free per-city UV index page you may want to link
>
> Hello,
>
> I run uvatlas.com, a small free site that shows the current UV index and the
> day's forecast for [13 Australian cities / 50 US cities], one page per city,
> with no login and no app.
>
> I'm writing because [your page on sun protection / your outdoor worker
> guidance] lists where readers can find the daily UV index, and uvatlas may be
> a useful addition. What it does that the existing options don't:
>
> - A page per city, so Perth or Hobart is one click, not a widget three
>   scrolls into a weather portal.
> - [Australia: every reading comes from the nearest ARPANSA station and carries
>   that credit beside the number.] [US: hourly forecasts from the EPA's own
>   feed, labelled as forecasts, because there is no instrument nearby.]
> - A "this time of year" figure for most cities, from the long measured record,
>   so a reader can see whether today is unusual.
> - It loads in well under a second on a phone and runs no trackers.
>
> Where the numbers come from, and what each one can and cannot be used for, is
> set out at uvatlas.com/methods/.
>
> If it's useful, a link from [that page] would be very welcome. Happy to link
> back to [your resource] from our own pages if that's of any interest — but
> there's no expectation either way, and I'd rather you only link it if you
> think it genuinely helps your readers.
>
> Thanks for your time,
> [Name]
> uvatlas.com

### B — ARPANSA specifically

Keep this separate from the licence request, or send it as part of the same
letter. Do not imply ARPANSA endorses the site.

> **Subject:** uvatlas.com — ARPANSA data credit, and a possible listing
>
> Hello,
>
> I run uvatlas.com, which publishes the current UV index for thirteen
> Australian cities. Every Australian reading on the site comes from the nearest
> ARPANSA measurement station, and the credit appears in the same component as
> the number itself, so the two cannot be shown apart. The sources, the
> staleness rule and the treatment of the `<status>` field are documented at
> uvatlas.com/methods/.
>
> Two things:
>
> 1. If anything about how the data is attributed or described falls short of
>    what ARPANSA expects, I'd like to know and will fix it.
> 2. If ARPANSA maintains a list of services that present its UV data, I'd be
>    glad to be considered for it.
>
> [If the licence request is live: I have separately written to [contact] about
> written authorisation for commercial use, and I'm happy for the two to be
> handled together.]
>
> Thanks,
> [Name]

### C — independent outdoor sites (Tier 2, the actual exchange offer)

> **Subject:** Swapping a link — UV index pages for [site name]'s readers
>
> Hi [name],
>
> I've been reading [site] for a while — [one specific, true sentence about a
> post]. I've built something your readers might use, and I'd like to propose a
> straight swap.
>
> uvatlas.com shows the current UV index and the day's forecast for
> [city/cities], a page per city, free, no app, no account. For anyone heading
> out at midday it answers the one question a general forecast buries: how long
> before skin starts burning, right now.
>
> What I'm proposing: a link from [your resources/links page] to the city pages
> your readers would want — say uvatlas.com/au/melbourne/ — and in return I'll
> link to [specific page of theirs] from [specific page of mine, e.g. our
> Victorian city pages or our UV index explainer], as a genuinely useful
> companion rather than a reciprocal-links page. I'd keep it to a real
> in-content link; I don't run a partners page and don't want one.
>
> If it's not a fit, no hard feelings at all — just say so and I won't follow
> up.
>
> Cheers,
> [Name]
> uvatlas.com

### D — follow-up, once, after 10–14 days

> **Subject:** Re: [original subject]
>
> Hi [name], just floating this back to the top of your inbox in case it got
> buried. If it isn't something you want, a one-line no is a perfectly good
> answer and I won't write again.
>
> [Name]

## How to work the list

1. Flip `SITE_INDEXABLE` and submit the sitemaps. Nothing before this counts.
2. Every address above was read off the organisation's own contact page on
   27 October 2026, with one exception: ARPANSA, whose contact page would not
   load — use their web form rather than the address from their annual reports.
   If you add candidates later, verify the same way. Don't guess from a
   pattern, and don't use addresses from data-broker sites like prospeo.io —
   those are scraped and often wrong.
3. Tier 1 first, one at a time, over weeks. Ten of these outweigh the whole of
   Tier 2.
4. Keep a plain-text log of who was emailed, when, and the answer. One
   follow-up, never two.
5. If any site asks you to add them to a "link partners" page, decline. That
   page is the liability.

## Sources

- [Google link spam policy, explained](https://eseospace.com/blog/google-link-spam-policy/)
- [Link swapping and Google's guidelines](https://www.linkgraph.com/?p=12217)
- [WorkSafe WA, sun safety in the workplace](https://www.worksafe.wa.gov.au/sun-safety-workplace)
- [Sydney North Health Network, use the UV index](https://sydneynorthhealthnetwork.org.au/use-the-uv-index-to-protect-yourself-from-sun-damage)
- [Cancer Council SA, SunSmart and skin resources](https://www.cancersa.org.au/health-professionals/resources/sunsmart-and-skin-resources/)
- [Cancer Council Queensland, UV exposure protection](https://resources.cancerqld.org.au/collections/uv-exposure-protection?page=2)
- [Melanoma Institute Australia, contact](https://melanoma.org.au/contact-us/)
- [The Skin Cancer Foundation, contact](https://www.skincancer.org/contact-us/)
- [AIM at Melanoma, contact](https://www.aimatmelanoma.org/contact-us/)
- [Richard David Kann Melanoma Foundation, contact](https://melanomafoundation.com/contact-us/)
- [Melanoma Research Foundation, contact](https://melanoma.org/contact-us/)
- [Outrun the Sun, contact](https://outrunthesun.org/info/contact-us)
- [Cancer Council Victoria, contact](https://www.cancervic.org.au/contact)
- [Cancer Council SA, contact](https://www.cancersa.org.au/contact-us/)
- [Cancer Council Queensland, contact](https://cancerqld.org.au/contact-us/)
- [WorkSafe WA, contact](https://www.worksafe.wa.gov.au/contact-us)
- [Sydney North Health Network, contact](https://sydneynorthhealthnetwork.org.au/contact-us/)
- [ARPANSA, contact](https://www.arpansa.gov.au/contact-us)
- [The Bushwalking Blog, contact](https://www.bushwalkingblog.com.au/contact/)
- [Trail Hiking Australia](https://www.trailhiking.com.au/)
- [Wild Magazine, contact](https://wild.com.au/contact/)
