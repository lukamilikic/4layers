<template>
  <section>
    <h2>Cart</h2>
    <p>{{ total }}</p>
  </section>
</template>

<script setup lang="ts">
// Reproduces the three violations shown in the README.
import { computed } from 'vue';
import { useCart } from '@/stores/cart';

import { fetchCart } from '@/api/cart';

import axios from 'axios';

const cart = useCart();
const total = computed(() => cart.total());

async function refresh() {
  await fetchCart();
  await axios.get('/ping');
}
</script>
