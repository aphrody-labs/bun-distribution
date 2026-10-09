import { Grid, Container, Typography, Fade, Zoom } from "@mui/material";

export function G() {
  return (
    <>
      <Container maxWidth="sm">
        <Grid container spacing={2}>
          <Grid item xs={6}>
            <Typography>a</Typography>
          </Grid>
          <Grid item xs={6}>
            <Typography color="primary">b</Typography>
          </Grid>
        </Grid>
      </Container>
      <Fade in>
        <span>f</span>
      </Fade>
      <Zoom in>
        <span>z</span>
      </Zoom>
    </>
  );
}
