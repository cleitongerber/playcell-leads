-- 016.3H: this Render environment is explicitly pre-operational. Enable the
-- separated journey only for partner records that already exist at rollout;
-- newly created partners retain the schema default (`legacy`) until an
-- explicit future rollout changes them.
UPDATE `partner_settings`
SET `leadJourneyMode` = 'separated_contact_v1'
WHERE `leadJourneyMode` <> 'separated_contact_v1';
