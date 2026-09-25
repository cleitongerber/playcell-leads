CREATE INDEX `follow_ups_partner_owner_completed_idx` ON `follow_ups` (`partnerId`,`ownerMembershipId`,`completedAt`,`dueAt`);--> statement-breakpoint
CREATE INDEX `lead_contacts_partner_actor_occurred_idx` ON `lead_contacts` (`partnerId`,`actorMembershipId`,`occurredAt`,`leadId`);--> statement-breakpoint
CREATE INDEX `lead_distribution_batches_partner_created_idx` ON `lead_distribution_batches` (`partnerId`,`createdAt`,`actorUserId`);--> statement-breakpoint
CREATE INDEX `lead_timeline_events_partner_type_occurred_idx` ON `lead_timeline_events` (`partnerId`,`type`,`occurredAt`,`actorMembershipId`,`leadId`);--> statement-breakpoint
CREATE INDEX `leads_partner_analytics_received_idx` ON `leads` (`partnerId`,`deletedAt`,`receivedAt`,`campaignId`,`pdvId`,`assignedMembershipId`);