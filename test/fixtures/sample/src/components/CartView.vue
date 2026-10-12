<template>
  <ul>
    <li v-for="line in cart.lines" :key="line.id">{{ line.title }}</li>
  </ul>
</template>

<script setup lang="ts">
// Fine: presentation -> application
import { useCart } from '@/stores/cart';
// Fine: presentation -> domain (type only, but still a declared edge)
import type { Order } from '@/domain/order';
// Violation: presentation -> infrastructure
import { fetchCart } from '@/api/cart';
// Violation: an HTTP client in a component
import axios from 'axios';

// import { nope } from '@/api/cart'  <- commented out, must not be reported

const cart = useCart();
defineProps<{ order?: Order }>();

async function refresh() {
  await fetchCart();
  await axios.get('/ping');
}
</script>

<style scoped>
li {
  color: red;
}
</style>
