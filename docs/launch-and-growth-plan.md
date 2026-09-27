# Timvot launch and growth plan

Draft: 25 September 2026. Market: Vietnam. This is a working plan; targets below are learning thresholds, not forecasts.

## The decision Timvot should own

**Who first:** Vietnamese badminton players choosing their first serious racket or an upgrade, especially players in their first three years who have a budget but cannot translate reviews and specifications into a confident choice. Interview buyers at several price points before narrowing the launch audience further.

**Job to be done:** “Help me choose a racket that fits how I play now, gives me room to improve, and is worth its current price.”

**Promise:** Answer a few questions, get a short list with reasons, compare the trade-offs, and see actual offers in Vietnam in one place.

**Positioning:** Timvot is a Vietnamese badminton racket decision guide that connects player fit, model facts, community evidence, and local prices. It does not need to claim a unique quiz: brands and specialist sites already have selectors. Its opportunity is to connect a *personal recommendation* to *current Vietnamese buying evidence* and explain the recommendation plainly.

### Pain-point story, from social search to purchase

1. A player sees a racket in a Facebook group or a YouTube/TikTok review. The post may be persuasive, but the reviewer plays differently and the model or variant may be unclear.
2. The player opens several tabs to learn what 4U, balance, and shaft stiffness mean. Advice conflicts, and “best racket” lists rarely ask about skill, playing style, or the player's next goal.
3. The player finds several seller posts with different prices, condition, stock, and age. It is hard to know whether the price is good, the offer is still available, or a newer version is a better use of the budget.
4. Timvot turns that search into a decision: a short fit questionnaire, two or three explained options, side-by-side differences, relevant independent video/review evidence, and seller offers with a freshness date.

**Important distinction:** “Release year” is the year a model or version launched. It is not the age or condition of a particular used racket. Show both separately whenever used offers are involved.

### Copy to test

**Vietnamese homepage headline:** “Chọn vợt hợp trình độ. Biết vì sao. Mua đúng giá.”

**Subheading:** “Trả lời vài câu về lối chơi, mục tiêu và ngân sách. Timvot gợi ý vợt phù hợp, giải thích điểm được và điểm đánh đổi, rồi cho bạn xem giá đang bán tại Việt Nam.”

**Short social introduction:** “Mình từng phải lục nhóm Facebook, xem nhiều video rồi vẫn không biết cây vợt nào hợp mình hoặc giá nào là hợp lý. Timvot gom thông số, đánh giá và giá bán để bạn chọn nhanh hơn. Dùng thử công cụ tìm vợt miễn phí: timvot.com/vi/finder.”

**English one-liner:** “Find a badminton racket that fits your game and budget, with the reason and the current price in one place.”

Avoid “perfect racket,” “guaranteed best price,” and unqualified “verified” claims. Show how a seller, review, or price earns its label.

## Current product baseline

The repository already includes a bilingual racket catalogue, five-question Finder, explainable shortlist, release year, racket comparison, seller offers, price history, deals, watchlist/alerts, reviews, guides, and seller onboarding. The Finder currently asks experience, singles/doubles, court position, shoulder/elbow trouble, and budget. It gives five matches with one reason each. The detail page carries the richer evidence.

For the first release, the strongest improvement is to connect these existing parts into one buyer path. The Finder result currently has a price and seller count but does not let a player assess price quality, video evidence, or the most important trade-offs without opening more pages. There is no video field visible in the current Finder or racket detail implementation. Treat video as a curated future addition, not a launch claim.

## Release sequence

| Stage | Timebox | Deliverable | Exit gate |
| --- | --- | --- | --- |
| 0. Buyer discovery | 1–2 weeks | Interview 15–20 recent or active buyers recruited from clubs, courts, shops, and groups. Record their last search, rejected options, budget, and what finally made them buy. Observe five people using the existing Finder. | At least 10 interviews reveal a repeated decision problem; identify the first audience and its top three questions. |
| 1. Private beta | 2–3 weeks | Improve the Finder result into a decision view; audit the most searched 30–50 models and their variants, release years, images, prices, and offer freshness. Invite 30–50 buyers personally. | At least 8 of 10 observed testers can explain why a result fits and find a seller offer without help; no material model/variant or stale-price errors in the audited set. |
| 2. Public launch | 2 weeks | Vietnamese-first landing copy, polished mobile Finder, shareable result/compare links, basic funnel analytics, 10–15 useful model/price guides, creator/club launch content. | Support and data checks pass; publish to channels that produced beta participants. |
| 3. Growth loop | Following 6–8 weeks | Add curated video evidence on priority models, price context, better review collection, alerts, and content from real questions. Test one small paid campaign only after organic visits reach the Finder. | Repeat weekly use, qualified seller clicks, and buyer feedback improve; continue only channels with clear downstream actions. |

Keep the public promise narrower than the database: launch around the model and price ranges with dependable data. An incomplete catalogue can still be useful; an incorrect match or stale deal damages trust.

## Product priorities

| Priority | Buyer need | Product behavior | Status |
| --- | --- | --- | --- |
| P0 | Start without knowing jargon | Prominent “Find my racket” path; five or fewer simple questions; explain terms in plain Vietnamese. After the first result, offer optional refinements: “what do you want to improve?”, “which racket do you use/love now?”, and “how recent must the model be?” Keep a skip option and show when a strong older model offers better value. | Finder exists; entry point and refinements need validation. |
| P0 | Understand a recommendation | Show 2–3 leading matches first, each with “why it fits,” “what you give up,” level, model/version year, and one meaningful alternative. Preserve access to all five. Do not present a score as a substitute for an explanation. | Fit reasons exist; trade-offs and clearer shortlist are needed. |
| P0 | Know whether the price is good | On each result show current lowest *available* offer, seller, variant, condition, last checked, and price versus the available 30-day history. If history is sparse, say “not enough price history” rather than “good deal.” Include shipping/stringing when known. | Offers and history exist on detail pages; context is missing from Finder results. |
| P0 | Compare without losing context | One responsive decision view: sticky shortlist, fit reasons, key specs in plain language, current offers, and a two- or three-racket comparison. On mobile use stacked cards and a persistent compare action rather than a cramped table. | Compare exists separately; integrated journey is needed. |
| P0 | Trust the data | Normalize model and weight/grip variant, separate release year from used-item condition, let the buyer set a model release-year preference, show price observation time, stock status, review verification rules, and source/method links. Audit high-traffic models manually. | Much of the data model exists; surface provenance and freshness clearly. |
| P1 | See independent evidence | Add 1–3 relevant YouTube/creator videos per priority model, with creator name, date, topic, and optional useful timestamp. Link or embed with attribution; obtain any required permissions. Label owner tests, retailer reviews, and community opinions distinctly. | Not present in current Finder/detail UI. |
| P1 | Save and return | Shareable shortlist/compare URL, save target price, and alert on a real qualifying price move. No account required before the first useful answer. | Watchlist/alerts exist; shareable decision state needs work. |
| P2 | Know how it feels in real play | Reviews tagged by self-reported skill, play format, duration of use, string/tension, and verified ownership where available. Ask concrete questions such as defense speed and fatigue instead of only a star score. | Reviews exist; structured context is a later upgrade. |
| P2 | Ask follow-up questions | A guided follow-up such as “Why this over Astrox 77 Play?” grounded in catalogue facts, seller offers, and cited reviews. Start with deterministic answers and common comparison templates; add open-ended AI only when evidence and evaluation are reliable. | Future experiment. |

**Decision screen concept:** Header with “your game and goal” → three recommendation cards → one comparison drawer/table → price and seller panel → review/video evidence → “buying checklist” and next action. A person should see the decisive facts together without opening five browser tabs. Keep dense technical specs available for experienced users.

## First users: high-touch acquisition

1. Recruit 15–20 interviewees from local courts/clubs, friends who recently bought, badminton group questions, and shop conversations. Ask for their last actual buying story, not “would you use this?” Do not scrape private group posts or spam groups.
2. Invite the first 30–50 beta buyers individually. Offer a free “send your budget and current racket; I’ll help you use the Finder” session. Record where the result feels wrong and which evidence is missing. Ask for permission before quoting or posting their story.
3. Work with 3–5 coaches or club captains. Give each a direct Finder link and a short comparison card they can use when players ask for equipment help. Ask for candid corrections, not endorsements.
4. Approach 3–5 local shops only after buyer trust is clear. Ask them to verify price, stock, exact variant, and service details. Label any paid placement; keep ranking and recommendation rules independent of payment.
5. In relevant Facebook groups, answer the actual question with a useful mini comparison first. Share a Timvot link only where group rules allow and when it genuinely adds evidence. A sample answer: “For doubles defense at ₫2m, I would compare these two for swing speed and shaft feel; here is how their current prices differ.”

**First-user offer:** free, no-account Finder plus a transparent shortlist and prices. The incentive is a better buying decision, not a giveaway that attracts people who are not shopping for a racket.

## Marketing and growth loop

**Loop:** Real buyer question → useful short answer/video → Finder or model comparison page → shareable shortlist → seller click, saved alert, or another question → new content and data improvement.

| Channel | Job | Weekly experiment | Destination |
| --- | --- | --- | --- |
| Facebook groups and local clubs | Reach buyers in the moment of confusion | 5–10 thoughtful answers where allowed, plus one admin-approved comparison post. Track questions that repeat. | Relevant model comparison or Finder; never a generic home page. |
| TikTok | Show a quick “I was confused; here is the trade-off” story | 2–3 original vertical videos. Test hooks based on budget, skill, and a common pair of rackets. Show the actual site result on screen. | Dedicated answer/compare page via profile or available link placement. |
| Instagram Reels and carousels | Saveable buying education | Adapt the best TikTok topic into a Reel; make one carousel explaining a spec or price comparison. Reply to comments with the next topic. | Model page or concise guide. |
| YouTube Shorts and longer reviews | Capture research intent | One short answer weekly; build a longer comparison only when the same question repeats. Add clear model names and sources. | Relevant comparison/guide link where supported. |
| Search and on-site guides | Capture high-intent queries over time | Publish a small number of original, source-checked pages such as “Astrox 77 Play vs Tour in Vietnam” and “Best options under ₫2m for beginner doubles.” Refresh prices and dates. | Finder prefilled for the question and model offers. |
| Creator/coach partnerships | Borrow expertise and receive corrections | Invite small badminton creators to critique one comparison or explain their own playtest. Pay or disclose incentives clearly if applicable. | Co-created model evidence page. |

**Content formula:** Specific buyer question → relevant fact/trade-off → live Timvot screen → one action. Examples: “Vợt 4U có phải lúc nào cũng dễ đánh?”, “Cây nào giúp phòng thủ đôi ở tầm ₫2 triệu?”, “Mẫu đời cũ có còn đáng mua nếu rẻ hơn 30%?” Distinguish a model's release year from the age of a used listing in every “old vs new” piece.

**Video script to test (20–30 seconds):** “Bạn xem 5 review mà vẫn chưa biết chọn vợt nào dưới ₫2 triệu? [show the conflicting tabs] Nhập trình độ, đánh đơn/đôi và ngân sách. [show two actual results] Cây A dễ xoay hơn, cây B cho cảm giác tấn công hơn; đây là giá và người bán hiện tại. Xem lý do và so sánh tại Timvot.” Use real model claims and actual price observations when recording; put the observation date on screen.

TikTok's own creative guidance recommends a hook, evidence/body, and clear close, and Instagram offers account-specific best-practice guidance in the professional dashboard. Treat those as creative starting points, then measure Timvot's own results rather than copying claimed platform “hacks.”

**Paid ads:** Defer broad spend until the organic path proves that visitors start and finish the Finder. Then run a small, fixed-budget two-week test with 2–3 distinct problem-led creatives and a dedicated landing page. Optimize for completed Finder/qualified seller intent, not views or followers. Stop an ad if it brings clicks but no useful decisions. Paid search can test a few high-intent model comparison queries once those pages are accurate.

## Measurement and decisions

Track a privacy-conscious funnel: source/campaign → landing view → Finder start → Finder completion → result view → compare/detail → seller click or alert save. Add a small “Was this recommendation useful? Why/why not?” prompt and record specific reasons. Track data quality separately: price freshness, stock accuracy, image coverage, model/variant correctness, and empty-result rate.

**North-star working metric:** weekly buyers who complete a Finder or meaningful comparison **and** take an informed next step (seller click, saved price alert, or share). This is a proxy for a useful decision, not proof of purchase.

**Initial learning thresholds for the first 100 qualified visitors:** at least 40 Finder starts, 25 completions, 10 seller/detail actions, and five substantive feedback responses. These are proposed gates for diagnosing the funnel, not industry benchmarks. Review recordings/interviews before changing thresholds. If starts are low, fix the landing promise; if completions are low, simplify questions; if seller actions are low, improve explanation, price trust, and offer coverage.

Review weekly by acquisition source and by buyer segment. Report absolute counts alongside rates while traffic is small. Do not equate page views or social followers with useful product adoption.

## What to learn from existing products

- [Yonex's badminton racquet selector](https://www.yonex.com/badminton/racquetselector) shows that a fast style-based selector and shareable matches are familiar. Timvot should add cross-brand choices and local purchase evidence.
- [Yonex's catalogue comparison](https://www.yonex.com/sports/badminton/products/badminton/racquets) demonstrates that spec comparison is expected; Timvot's advantage should be explaining what those differences mean for a particular player.
- [RacketFind](https://racketfind.com/) combines a questionnaire, ranked matches, and comparison, so Timvot should not market “a quiz” as novel. The differentiation to test is trustworthy Vietnam pricing, variants, freshness, and evidence on the decision screen.
- [Tennis Warehouse's selector](https://www.tennis-warehouse.com/racfinder.html?ccode=RACFINDER) introduces recommendations by skill level and explains why level changes the choice. Timvot can use similarly plain language for badminton while keeping the path shorter.
- [TikTok's creative codes](https://ads.tiktok.com/business/en/creative-codes) and [Instagram's best-practices hub](https://about.fb.com/news/2024/10/best-practices-education-hub-creators-instagram/) support a test-and-learn content approach. [Facebook group participation controls](https://www.facebook.com/help/1414053028933409/) reinforce checking each group's posting rules before promotion.

## Next seven days

1. Choose one starting segment and write an interview screener for recent racket buyers.
2. Recruit the first ten interviewees and observe five Finder sessions on mobile.
3. Audit the 30 most likely launch models: exact variant, release year, stock, price age, and seller link.
4. Sketch and test the integrated Finder decision screen with three real rackets, including one sparse-price case.
5. Prepare three question-led posts and two short videos from genuine buyer questions; send each to a relevant deep link.
6. Add funnel events and a simple usefulness prompt before spending on acquisition.

The first public message should go out only after a buyer can follow the entire path from question to trustworthy offer on a phone.
