# Spec: app-research-library

# Requirements: App 2 — Research Library

Lives in `/apps/research-library`. The vague-description search requirement is owned by the `search` spec; this app demos it. App-specific requirements are labelled `RL-n`.

## Requirements

### Requirement RL-1: Research Library goal spec
**User Story:** As a reader, I want articles, arXiv papers, RSS items, and PDFs compiled into topic pages, so that a saved article is easy to find again.
#### Acceptance Criteria
1. WHEN an article, paper, RSS item, or PDF is compiled, THE SYSTEM SHALL produce an `Article` item with required `title` and `url` and optional authors, published, source, summary (max 600 chars), key_points, and topics.
2. WHEN the source is on arxiv.org, THE SYSTEM SHALL apply the `arxiv_metadata` mapper; otherwise THE SYSTEM SHALL apply `open_graph+article_meta`.
3. WHEN topics are extracted, THE SYSTEM SHALL produce 1–3 word noun phrases and reuse existing topics when they fit.
4. WHEN articles are saved, THE SYSTEM SHALL group them into pages by `topics`, each with a summary that cites its items.

### Requirement RL-2: Topic page view
**User Story:** As a reader, I want a topic page, so that I see what my sources say about a subject.
#### Acceptance Criteria
1. WHEN the user opens a topic, THE SYSTEM SHALL render the `TopicPage` view with the page summary and links to its items.

### Requirement RL-3: Vague-article search demo
**User Story:** As a reader, I want "find the article about on-device LLMs in Research Library" to work, so that vague memory is enough.
#### Acceptance Criteria
1. WHEN the user searches Research Library with a vague description, THE SYSTEM SHALL return the intended article in the top results for the demo fixtures.

### Requirement RL-4: Thin app target
#### Acceptance Criteria
1. WHEN the Research Library app is built, THE SYSTEM SHALL consist of the goal spec, a thin web entry point, and the topic page component, with everything else from `/web-kit` and `/core` (web-first).
2. WHEN the Research Library app is deployed, THE SYSTEM SHALL serve it at a public URL that works in phone and desktop browsers.


---

