ALTER TABLE cook_events ADD COLUMN occasion TEXT NOT NULL DEFAULT '';
ALTER TABLE cook_event_reactions ADD COLUMN taste INTEGER CHECK (taste BETWEEN 1 AND 5);
ALTER TABLE cook_event_reactions ADD COLUMN complexity INTEGER CHECK (complexity BETWEEN 1 AND 5);
ALTER TABLE cook_event_reactions ADD COLUMN review TEXT NOT NULL DEFAULT '';

UPDATE cook_events
SET occasion = notes
WHERE occasion = '' AND notes <> '';

UPDATE cook_event_reactions
SET review = note
WHERE review = '' AND note <> '';
