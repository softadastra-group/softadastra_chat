const schemaSQL = `
CREATE TABLE IF NOT EXISTS feed_posts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  body TEXT NULL,
  reply_to_id BIGINT UNSIGNED NULL,
  visibility ENUM('public','followers') NOT NULL DEFAULT 'public',
  media_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  likes_count INT UNSIGNED NOT NULL DEFAULT 0,
  replies_count INT UNSIGNED NOT NULL DEFAULT 0,
  reposts_count INT UNSIGNED NOT NULL DEFAULT 0,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_feed_user_created (user_id, created_at DESC),
  KEY idx_feed_created (created_at DESC),
  KEY idx_feed_reply (reply_to_id),
  FULLTEXT KEY ft_feed_body (body)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS feed_post_media (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  post_id BIGINT UNSIGNED NOT NULL,
  url VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL DEFAULT 'image/jpeg',
  position TINYINT UNSIGNED NOT NULL DEFAULT 1,
  width INT UNSIGNED NULL,
  height INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_media_post (post_id),
  CONSTRAINT fk_media_post FOREIGN KEY (post_id)
    REFERENCES feed_posts(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS feed_post_likes (
  post_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, user_id),
  KEY idx_like_user (user_id),
  CONSTRAINT fk_like_post FOREIGN KEY (post_id)
    REFERENCES feed_posts(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const truncateSQL = `
SET FOREIGN_KEY_CHECKS=0;
TRUNCATE TABLE feed_post_likes;
TRUNCATE TABLE feed_post_media;
TRUNCATE TABLE feed_posts;
SET FOREIGN_KEY_CHECKS=1;
`;

module.exports = { schemaSQL, truncateSQL };
