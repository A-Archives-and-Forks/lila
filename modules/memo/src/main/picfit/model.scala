package lila.memo

import reactivemongo.api.bson.Macros.Annotations.Key
import lila.core.id.ImageId
import lila.core.config.{ Secret, CollName, ImageGetOrigin }

case class PicfitImage(
    @Key("_id") id: ImageId,
    user: UserId,
    // reverse reference like blog:id, streamer:id, coach:id, ...
    // unique: a new image will delete the previous ones with same rel
    rel: String,
    name: String,
    size: Int, // in bytes
    createdAt: Instant,
    dimensions: Option[Dimensions],
    context: Option[String] = none,
    automod: Option[ImageAutomod] = none,
    urls: List[String] = Nil
)

final class PicfitConfig(
    val collection: CollName,
    val endpointGet: Url,
    val endpointPost: Url,
    val secretKey: Secret
):
  val imageGetOrigin = lila.common.url.origin(endpointGet).into(ImageGetOrigin)

case class Dimensions(width: Int, height: Int):
  def vertical = height > width
object Dimensions:
  def square(pixels: Int) = Dimensions(pixels, pixels)
  // 560x560 containment consumes the minimum 1601 tokens according to the formula here:
  // https://docs.together.ai/docs/vision-overview#pricing
  val defaultPixels = 560
  val default = square(defaultPixels)
  val defaultWidth = Dimensions(defaultPixels, 0)
  val defaultHeight = Dimensions(0, defaultPixels)

// presence of the ImageAutomod subdoc indicates an image has been scanned, regardless of flagged
case class ImageAutomod(flagged: Option[String] = none)

case class ImageAutomodRequest(id: ImageId, dim: Dimensions)
