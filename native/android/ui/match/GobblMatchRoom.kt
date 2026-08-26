package com.gobbl.app.ui.match

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.VectorConverter
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch

@Composable
fun SwipeableFoodCard(
    name: String,
    restaurant: String,
    price: Double,
    imageUrl: String,
    onSwipedRight: () -> Unit,
    onSwipedLeft: () -> Unit,
    modifier: Modifier = Modifier
) {
    val scope = rememberCoroutineScope()
    val offset = remember { Animatable(Offset.Zero, Offset.VectorConverter) }

    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF141414)),
        modifier = modifier
            .fillMaxWidth()
            .height(400.dp)
            .offset(x = offset.value.x.dp, y = offset.value.y.dp)
            .graphicsLayer { rotationZ = (offset.value.x / 25).coerceIn(-20f, 20f) }
            .pointerInput(Unit) {
                detectDragGestures(
                    onDrag = { change, dragAmount ->
                        change.consume()
                        scope.launch { offset.snapTo(offset.value + dragAmount) }
                    },
                    onDragEnd = {
                        scope.launch {
                            if (offset.value.x > 250) onSwipedRight()
                            else if (offset.value.x < -250) onSwipedLeft()
                            else offset.animateTo(Offset.Zero)
                        }
                    }
                )
            }
    ) {
        Column {
            AsyncImage(
                model = imageUrl,
                contentDescription = name,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxWidth().height(260.dp)
            )
            Column(modifier = Modifier.padding(16.dp)) {
                Text(text = name, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Text(text = restaurant, color = Color(0xFF94A3B8), fontSize = 13.sp)
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "\$${String.format("%.2f", price)}",
                    color = Color(0xFFFF4D00),
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Black
                )
            }
        }
    }
}
