package com.gobbl.app.ui.feed

import android.view.HapticFeedbackConstants
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.VerticalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import kotlinx.collections.immutable.ImmutableList

@Immutable
data class FoodItemUi(
    val id: String,
    val name: String,
    val restaurant: String,
    val price: Double,
    val calories: Int,
    val imageUrl: String
)

@Composable
fun BiteFeedReel(
    items: ImmutableList<FoodItemUi>,
    onQuickGobblClick: (FoodItemUi) -> Unit,
    modifier: Modifier = Modifier
) {
    val pagerState = rememberPagerState(pageCount = { items.size })
    val view = LocalView.current

    VerticalPager(
        state = pagerState,
        beyondViewportPageCount = 1, // Prefetches 1 screen ahead for 120 FPS smoothness
        modifier = modifier.fillMaxSize().background(Color.Black),
        key = { items[it].id }
    ) { page ->
        val item = items[page]
        var showHeartAnim by remember { mutableStateOf(false) }

        val heartScale by animateFloatAsState(
            targetValue = if (showHeartAnim) 1.4f else 0f,
            animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy),
            finishedListener = { showHeartAnim = false }
        )

        Box(
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(Unit) {
                    detectTapGestures(
                        onDoubleTap = {
                            view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
                            showHeartAnim = true
                        }
                    )
                }
        ) {
            // Food Image Layer
            AsyncImage(
                model = item.imageUrl,
                contentDescription = item.name,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )

            // Dark Scrim Gradient
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(
                                Color.Black.copy(alpha = 0.3f),
                                Color.Transparent,
                                Color.Black.copy(alpha = 0.85f)
                            )
                        )
                    )
            )

            // Double Tap Heart Burst Animation
            if (heartScale > 0.05f) {
                Icon(
                    imageVector = Icons.Default.Favorite,
                    contentDescription = null,
                    tint = Color(0xFFFF4D00),
                    modifier = Modifier
                        .size(100.dp)
                        .align(Alignment.Center)
                        .scale(heartScale)
                )
            }

            // Bottom Food Card & Quick Order Bar
            Column(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(16.dp)
                    .fillMaxWidth()
            ) {
                Text(
                    text = item.name,
                    color = Color.White,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Black
                )
                Text(
                    text = "${item.restaurant} · ${item.calories} kcal",
                    color = Color(0xFFFFB800),
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold
                )

                Spacer(modifier = Modifier.height(12.dp))

                Button(
                    onClick = {
                        view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                        onQuickGobblClick(item)
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFF4D00)),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth().height(50.dp)
                ) {
                    Icon(Icons.Default.FlashOn, contentDescription = null, tint = Color.White)
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "Quick Gobbl • \$${String.format("%.2f", item.price)}",
                        color = Color.White,
                        fontWeight = FontWeight.Black
                    )
                }
            }
        }
    }
}
