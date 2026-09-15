await db.from('acm_pin_demo').update({ price: 0 }).gt('id', 0).select()
