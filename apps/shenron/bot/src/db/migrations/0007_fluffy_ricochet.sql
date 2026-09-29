CREATE TABLE `card_themes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`accent` text NOT NULL,
	`aura` text NOT NULL,
	`bg_grad_1` text NOT NULL,
	`bg_grad_2` text NOT NULL,
	`bg_grad_3` text NOT NULL,
	`bg_file` text,
	`text_shadow` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
-- Seed initial : importe les 8 thèmes hardcodés CARDS depuis CardService.ts
INSERT INTO `card_themes` (id, name, accent, aura, bg_grad_1, bg_grad_2, bg_grad_3, bg_file, text_shadow, enabled, created_at) VALUES
  ('default', 'DB Classic', '#F3E603', '#D67711', '#550000', '#D67711', '#1a0a00', 'assets/backgrounds/sun/close-up-view-of-an-active-region-of-the.webp', 'rgba(0,0,0,0.8)', 1, unixepoch()),
  ('goku', 'Goku', '#F85B1A', '#FA5A1E', '#3b0d00', '#F85B1A', '#072083', 'assets/backgrounds/earth/earth-observation-from-the-international.webp', 'rgba(7,32,131,0.8)', 1, unixepoch()),
  ('vegeta', 'Vegeta', '#2955DC', '#4169E1', '#0a0f3d', '#2955DC', '#181463', 'assets/backgrounds/galaxy/hubble-peeks-at-a-spiral-galaxy.webp', 'rgba(24,20,99,0.9)', 1, unixepoch()),
  ('kaio', 'Kaio-ken', '#FA0011', '#FF3030', '#4a0000', '#FA0011', '#1a0000', 'assets/backgrounds/nebula/weighing-in-on-the-dumbbell-nebula.webp', 'rgba(74,0,0,0.9)', 1, unixepoch()),
  ('ssj', 'Super Saiyan', '#F9EE54', '#FFD700', '#422006', '#F3A903', '#0f0800', 'assets/backgrounds/sun/full-disk-image-of-the-sun-march-26-2007.webp', 'rgba(66,32,6,0.9)', 1, unixepoch()),
  ('blue', 'Super Saiyan Blue', '#00E5FF', '#00B8FF', '#001a3d', '#0369a1', '#00091f', 'assets/backgrounds/aurora/aurora-borealis-at-kennedy-space-center.webp', 'rgba(0,26,61,0.9)', 1, unixepoch()),
  ('rose', 'Super Saiyan Rosé', '#FF4FB0', '#FF1493', '#3a0420', '#9d174d', '#0a0208', 'assets/backgrounds/nebula/ant-nebula.webp', 'rgba(58,4,32,0.9)', 1, unixepoch()),
  ('ultra', 'Ultra Instinct', '#E5E9F0', '#B4C4DD', '#000814', '#475569', '#000000', 'assets/backgrounds/galaxy/spiral-galaxy-m83.webp', 'rgba(0,8,20,0.95)', 1, unixepoch());
