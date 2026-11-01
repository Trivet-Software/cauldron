# Spec: app-research-library

# Requirements: App 2 — Research Library

Lives in `/apps/research-library`. The vague-description search requirement is owned by the `search` spec; this app demos it. App-specific requirements are labelled `RL-n`. Research Library serves exactly one app goal, defined by its goal file (goal-engine Requirement 8).

## Requirements

### Requirement RL-1: Research Library goal file
**User Story:** As a reader, I want articles, arXiv papers and PDFs compiled into topic pages, so that a saved article is easy to find again.
#### Acceptance Criteria
1. WHEN an article, paper, or PDF is compiled, THE SYSTEM SHALL produce an `Article` item with required `title` and optional `url`, `authors`, `published`, `source`, `summary` (max 600 chars), `key_points`, and `topics`. `url` is required for URL captures.
2. WHEN the source is on arxiv.org, THE SYSTEM SHALL apply the `arxiv_metadata` mapper; WHEN it is another web page, THE SYSTEM SHALL apply `open_graph+article_meta`; WHEN it is a PDF upload, THE SYSTEM SHALL apply the `pdf_metadata` mapper (title, author and date from the PDF's document info) before LLM extraction.
3. WHEN topics are extracted, THE SYSTEM SHALL produce 1–3 word noun phrases, and SHALL reuse one of the user's existing topics instead of adding a new one when the two match case-insensitively after singularizing, or their embedding similarity is at least 0.85.
4. WHEN articles are saved, THE SYSTEM SHALL group them into pages by `topics`, each with a summary that cites its items (capture-compile Requirement 13).
5. WHEN the goal file marks searchable fields, THE SYSTEM SHALL include `title`, `summary`, `topics` and `authors`, and SHALL mark `published` as the item date (goal-engine Requirement 9).
6. *(Stretch)* WHEN the user subscribes to an RSS feed, THE SYSTEM SHALL capture new feed items as articles (capture-compile Requirement 17).

### Requirement RL-2: Topic page view
**User Story:** As a reader, I want a topic page, so that I see what my sources say about a subject.
#### Acceptance Criteria
1. WHEN the user opens a topic, THE SYSTEM SHALL render the `TopicPage` view with the page summary and links to its items.

### Requirement RL-3: Vague-article search demo
**User Story:** As a reader, I want "find the article about on-device LLMs from last month" to work, so that a vague memory is enough.
#### Acceptance Criteria
1. WHEN the user searches Research Library with any of the vague queries in the demo fixtures, THE SYSTEM SHALL return the intended article in the top 3 results.

### Requirement RL-4: Thin app target
**User Story:** As a judge, I want the second app built from the same skeleton, so that I can see the template supports a different use case.
#### Acceptance Criteria
1. WHEN the Research Library app is built, THE SYSTEM SHALL consist of the goal file, a thin web entry point, and the TopicPage component, with everything else from `/web-kit` and `/core` (web-kit Requirement 7).
2. WHEN the Research Library app is deployed, THE SYSTEM SHALL serve it at a public URL that works in phone and desktop browsers.

---
